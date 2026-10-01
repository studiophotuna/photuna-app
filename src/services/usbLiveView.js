// src/services/usbLiveView.js
//
// One live view from the USB camera (beta), shared by every screen that shows the
// camera: the welcome screen's live background, the template screen (which keeps it
// warm) and the photo screen. Screens subscribe; the camera streams while anyone is
// subscribed and stops a moment after the last one leaves, so moving from one booth
// screen to the next does not restart it.
//
// Frames are pulled from the main process one at a time (camera:live-view-frame),
// so a slow camera slows the preview instead of queueing frames. A photo being taken
// pauses the pulls: the camera helper handles one command at a time.
//
// If live view cannot start, or stops sending frames, subscribers are told
// `failed: true` and fall back to the webcam. It is not retried for a short while,
// so a camera without live view does not delay every screen.

const STOP_DELAY_MS = 2500;
const FIRST_FRAME_DEADLINE_MS = 6000;
const MAX_FAILURES = 10;
// The time from one frame request to the next, not a pause added after each frame:
// a frame's round trip (camera download, IPC, decode) counts towards it. Sleeping a
// fixed 60 ms on top of the round trip held the preview near 8 fps on a Canon.
const FRAME_INTERVAL_MS = 33; // about 30 frames a second at most
const RETRY_AFTER_FAILURE_MS = 15000;

const subscribers = new Set();
let running = false;
let loopToken = 0;
let stopTimer = null;
let pauses = 0;
let failedAt = 0;
let lastFrame = null;
let state = { active: false, failed: false };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cameraApi() {
  if (typeof window === "undefined") return null;
  return (window.api ?? window.electron)?.camera ?? null;
}

// True when this app can show a USB camera's live view at all (desktop app).
export function isUsbLiveViewSupported() {
  return typeof cameraApi()?.startLiveView === "function";
}

function setState(next) {
  state = { ...state, ...next };
  for (const subscriber of subscribers) {
    try { subscriber.onState?.(state); } catch { /* a screen's handler must not stop the others */ }
  }
}

function clearLastFrame() {
  lastFrame?.close?.();
  lastFrame = null;
}

function fail(reason) {
  console.warn("[usbLiveView] live view unavailable; screens will use the webcam:", reason);
  running = false;
  failedAt = Date.now();
  clearLastFrame();
  setState({ active: false, failed: true });
}

async function runLoop(token) {
  const camera = cameraApi();
  const started = await camera.startLiveView().catch((err) => ({ ok: false, error: { code: "IPC_FAILED", message: err?.message } }));
  if (token !== loopToken) return;
  if (!started?.ok) {
    fail(started?.error?.code);
    return;
  }

  const startedAt = Date.now();
  let gotFrame = false;
  let failures = 0;

  while (token === loopToken) {
    if (pauses > 0) {
      await sleep(120);
      continue;
    }

    const requestedAt = performance.now();
    const frame = await camera.liveViewFrame().catch(() => null);
    if (token !== loopToken) break;

    if (frame?.ok && frame.jpeg) {
      try {
        const bitmap = await createImageBitmap(new Blob([frame.jpeg], { type: "image/jpeg" }));
        if (token !== loopToken) {
          bitmap.close?.();
          break;
        }
        const previous = lastFrame;
        lastFrame = bitmap;
        for (const subscriber of subscribers) {
          try { subscriber.onFrame?.(bitmap); } catch { /* keep feeding the other screens */ }
        }
        previous?.close?.();
        failures = 0;
        if (!gotFrame) {
          gotFrame = true;
          setState({ active: true, failed: false });
        }
      } catch {
        failures += 1;
      }
      const wait = FRAME_INTERVAL_MS - (performance.now() - requestedAt);
      if (wait > 1) await sleep(wait);
      continue;
    }

    const code = frame?.error?.code;
    if (code !== "NO_FRAME" && code !== "BUSY") failures += 1;
    const neverStarted = !gotFrame && Date.now() - startedAt > FIRST_FRAME_DEADLINE_MS;
    if (failures >= MAX_FAILURES || neverStarted) {
      camera.stopLiveView?.().catch?.(() => { });
      fail(code || "no frames");
      return;
    }
    await sleep(code === "NO_FRAME" ? 20 : 250);
  }
}

function start() {
  if (running) return;
  if (!isUsbLiveViewSupported()) {
    setState({ active: false, failed: true });
    return;
  }
  if (state.failed && Date.now() - failedAt < RETRY_AFTER_FAILURE_MS) return;
  running = true;
  loopToken += 1;
  setState({ active: false, failed: false });
  runLoop(loopToken);
}

function stop() {
  if (!running) return;
  running = false;
  loopToken += 1;
  cameraApi()?.stopLiveView?.().catch?.(() => { });
  clearLastFrame();
  setState({ active: false, failed: false });
}

/**
 * Receive the USB camera's live view.
 * @param {{ onFrame?: (bitmap: ImageBitmap) => void, onState?: (s: { active: boolean, failed: boolean }) => void }} subscriber
 *   onFrame must draw the bitmap straight away; it is closed when the next frame arrives.
 * @returns {() => void} unsubscribe
 */
export function subscribeUsbLiveView(subscriber) {
  subscribers.add(subscriber);
  clearTimeout(stopTimer);
  stopTimer = null;

  subscriber.onState?.(state);
  if (lastFrame) subscriber.onFrame?.(lastFrame);
  start();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      clearTimeout(stopTimer);
      stopTimer = setTimeout(stop, STOP_DELAY_MS);
    }
  };
}

/**
 * Pause frame pulls while the camera takes a photo. Returns the function that resumes
 * them; calling it more than once is harmless.
 */
export function pauseUsbLiveView() {
  pauses += 1;
  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    pauses = Math.max(0, pauses - 1);
  };
}
