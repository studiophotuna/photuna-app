
// src/PhotoBooth/PhotoScreen.jsx
import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { DEFAULT_APPEARANCE } from "../utils/appearance";
import { useLayout } from "../utils/useLayout";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import useUsbLiveView from "../hooks/useUsbLiveView";
import { isUsbLiveViewSupported, pauseUsbLiveView } from "../services/usbLiveView";


function normalizeTemplateGuide(templateSelection) {
  const slots =
    Array.isArray(templateSelection?.slots) && templateSelection.slots.length
      ? templateSelection.slots
      : Array.isArray(templateSelection?.previewMeta?.slots)
        ? templateSelection.previewMeta.slots
        : [];

  const layout =
    templateSelection?.previewMeta?.layout ??
    templateSelection?.layout ??
    "4x6";

  return { slots, layout };
}

function getLayoutAspectNumber(layout) {
  switch (String(layout || "").toLowerCase()) {
    case "6x4":
      return 6 / 4;
    case "2x6":
      return 2 / 6;
    case "6x2":
      return 6 / 2;
    case "4x6":
    default:
      return 4 / 6;
  }
}

function getSlotBounds(slots = []) {
  if (!Array.isArray(slots) || !slots.length) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  slots.forEach((slot) => {
    const x = Number(slot?.x ?? 0);
    const y = Number(slot?.y ?? 0);
    const w = Number(slot?.w ?? 0.2);
    const h = Number(slot?.h ?? 0.2);

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  const width = Math.max(0.0001, maxX - minX);
  const height = Math.max(0.0001, maxY - minY);

  return { minX, minY, maxX, maxY, width, height };
}

function getGuideAspectFromSlotsOrLayout(guide, slotIndex = 0) {
  const slots = Array.isArray(guide?.slots) ? guide.slots : [];

  if (slots.length > 0) {
    const safeIndex = Math.max(0, Math.min(slotIndex, slots.length - 1));
    const slot = slots[safeIndex];

    let slotW = Number(slot?.w);
    let slotH = Number(slot?.h);
    const rotation = Math.abs(Number(slot?.rotation || 0)) % 180;

    if (rotation === 90) {
      [slotW, slotH] = [slotH, slotW];
    }

    if (Number.isFinite(slotW) && Number.isFinite(slotH) && slotW > 0 && slotH > 0) {
      return slotW / slotH;
    }
  }

  return getLayoutAspectNumber(guide?.layout);
}

export default function PhotoScreen({
  event = null,
  templateSelection = null,
  eventId = "default",
  countdownSeconds = 5,
  numberOfShots = 6,
  frame = null,
  retakeIndices = null,
  onCapture = () => { },
  onFinish = () => { },
  onCancel = () => { },
  mirrorCamera,
  session, // { sessionId, token, previewUrl }
  cameraStreamRef = null,
}) {
  const { isPortrait, isUnsupported, isTablet } = useLayout();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const activeRecorderRef = useRef(null);

  const previewWrapRef = useRef(null);
  const [previewRect, setPreviewRect] = useState({ width: 0, height: 0 });

  const [timer, setTimer] = useState(countdownSeconds);
  const [photosTaken, setPhotosTaken] = useState(0);
  const currentShotIndex = photosTaken;
  const [isFlashing, setIsFlashing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  const guide = normalizeTemplateGuide(templateSelection);
  // Clone slots share a photo with their source — exclude them from capture sequencing
  const primaryGuide = { ...guide, slots: guide.slots.filter(s => !s.sourceSlotId) };

  const pendingClipPromisesRef = useRef([]);
  const currentClipPromiseRef = useRef(null);

  const activeGuideIndex = retakeIndices
    ? retakeIndices[photosTaken] ?? 0
    : photosTaken;

  const guideAspect = getGuideAspectFromSlotsOrLayout(primaryGuide, activeGuideIndex);

  const activeSlot =
    Array.isArray(primaryGuide.slots) && primaryGuide.slots.length
      ? primaryGuide.slots[Math.max(0, Math.min(activeGuideIndex, primaryGuide.slots.length - 1))]
      : null;

  const showSlotGuide = event?.settings?.showSlotGuide ?? true;
  const guideOpacity = event?.settings?.guideOpacity ?? 0.95;
  const guideColor = event?.settings?.guideColor ?? "#ffffff";
  const guideMaskOpacity = event?.settings?.guideMaskOpacity ?? 0.22;

  const capturesRef = useRef([]);

  // Load global settings as fallback for camera config not in the event
  const [globalCameraSettings, setGlobalCameraSettings] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const s = await (window.api ?? window.electron)?.getSettings?.();
        if (s && Object.keys(s).length > 0) setGlobalCameraSettings(s);
      } catch {}
    })();
  }, []);

  const gs = globalCameraSettings ?? {};
  const gsRef = useRef(gs);
  useEffect(() => { gsRef.current = gs; }, [gs]);
  const effectiveMirrorCamera =
    typeof mirrorCamera === "boolean"
      ? mirrorCamera
      : !!(event?.settings?.mirrorCamera ?? gs.mirrorCamera);

  // "usb": photos come from a camera connected by USB (beta). Guests see the camera's
  // own live view — shared with the welcome and template screens so it keeps running
  // between them (services/usbLiveView.js) — drawn into usbPreviewCanvasRef, and
  // motion clips are recorded from that canvas. If live view is unavailable or stops,
  // the webcam preview takes over. A shot the USB camera misses is taken from its last
  // live view frame (or the webcam), so a guest never loses a shot.
  const usbCameraApi = (window.api ?? window.electron)?.camera;
  const useUsbCamera = !!usbCameraApi?.captureStill && isUsbLiveViewSupported()
    // This booth's own setting first: it describes the PC the booth runs on, and an
    // event's copy can be older.
    && (gs.cameraSource ?? event?.settings?.cameraSource) === "usb";
  const usbPreviewCanvasRef = useRef(null);
  const usbPreviewStreamRef = useRef(null);
  const { active: usbPreviewActive } = useUsbLiveView(useUsbCamera, usbPreviewCanvasRef);
  const previewReady = cameraReady || usbPreviewActive;

  // Stop the canvas stream used for motion clips when the camera's preview goes away.
  useEffect(() => {
    if (!usbPreviewActive) return undefined;
    return () => {
      usbPreviewStreamRef.current?.getTracks?.().forEach((track) => track.stop());
      usbPreviewStreamRef.current = null;
    };
  }, [usbPreviewActive]);

  const sessionIdRef = useRef(session?.sessionId || null);
  useEffect(() => { sessionIdRef.current = session?.sessionId || null; }, [session]);

  const initCamera = React.useCallback(async () => {
    try {
      const g = gsRef.current;
      const desiredWidth = event?.config?.cameraWidth ?? event?.settings?.cameraWidth ?? g.cameraWidth ?? 1920;
      const desiredHeight = event?.config?.cameraHeight ?? event?.settings?.cameraHeight ?? g.cameraHeight ?? 1080;
      const facingMode = event?.config?.facingMode ?? event?.settings?.facingMode ?? g.facingMode ?? "user";
      const deviceId = event?.settings?.selectedCameraId ?? g.selectedCameraId;
      let stream = cameraStreamRef?.current ?? window.__cameraStream;

      // If a specific device is required, verify the preloaded stream is on that device
      if (stream && deviceId) {
        const activeDeviceId = stream.getVideoTracks()[0]?.getSettings?.()?.deviceId;
        if (activeDeviceId && activeDeviceId !== deviceId) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
          if (cameraStreamRef) cameraStreamRef.current = null;
          window.__cameraStream = null;
        }
      }

      if (!stream) {
        const videoConstraints = deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: desiredWidth }, height: { ideal: desiredHeight } }
          : { width: { ideal: desiredWidth, max: desiredWidth }, height: { ideal: desiredHeight, max: desiredHeight }, facingMode };

        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });

        if (cameraStreamRef) cameraStreamRef.current = stream;
        window.__cameraStream = stream;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => { });
      }
      setCameraReady(true);
      setCameraError(null);
    } catch (err) {
      setCameraError(err?.message ?? "camera_unavailable");
      setCameraReady(false);
    }
  }, [event]);

  useEffect(() => {
    let mounted = true;

    const start = async () => {
      try {
        await initCamera();
      } catch (e) {
        console.error("initCamera failed:", e);
      }
    };

    start();

    return () => {
      mounted = false;
      try {
        streamRef.current?.getTracks?.().forEach((t) => t.stop());
        streamRef.current = null;
        if (cameraStreamRef) cameraStreamRef.current = null;
        window.__cameraStream = null;
      } catch { }
    };
  }, [initCamera, eventId]);

  /* ------------------------------------------------------------------ */
  /* Resolve appearance & settings                                      */
  /* ------------------------------------------------------------------ */
  const appearance = {
    ...DEFAULT_APPEARANCE,
    ...(event?.appearance || {}),
  };

  const {
    boothName,
    tagline,
    headerFont,
    generalFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    logoPath,
    logoSize,
    backgroundMediaPath,
    buttonBgColor,
    buttonHoverColor,
    buttonFont,
    buttonFontColor,
  } = appearance;
  const logoScale = (logoSize ?? 100) / 100;

  // Settings (AdminDashboard)
  const flashEnabled = event?.settings?.flashEnabled ?? true;
  const soundEnabled = event?.settings?.soundEnabled ?? true;
  const language = event?.settings?.language ?? "en";

  function getFittedBox(containerW, containerH, targetAspect) {
    const containerAspect = containerW / containerH;

    if (containerAspect > targetAspect) {
      const height = containerH;
      const width = height * targetAspect;
      return {
        width,
        height,
        left: (containerW - width) / 2,
        top: 0,
      };
    }

    const width = containerW;
    const height = width / targetAspect;
    return {
      width,
      height,
      left: 0,
      top: (containerH - height) / 2,
    };
  }

  useEffect(() => {
    const updatePreviewRect = () => {
      const el = previewWrapRef.current;
      if (!el) return;
      setPreviewRect({
        width: el.clientWidth,
        height: el.clientHeight,
      });
    };

    updatePreviewRect();
    window.addEventListener("resize", updatePreviewRect);

    const ro = new ResizeObserver(updatePreviewRect);
    if (previewWrapRef.current) ro.observe(previewWrapRef.current);

    return () => {
      window.removeEventListener("resize", updatePreviewRect);
      ro.disconnect();
    };
  }, []);

  const isTagalog =
    String(language).toLowerCase() === "tagalog" ||
    String(language).toLowerCase() === "tl" ||
    String(language).toLowerCase() === "filipino";

  const t = {
    counter: isTagalog ? "Kunan" : "Shots",
    preparingTitle: isTagalog ? "Inihahanda ang iyong mga litrato…" : "Getting your photos ready…",
    preparingBody: isTagalog ? "Sandali, ihahanda namin ang susunod na bahagi." : "Just a moment while we set up the next step.",
    cameraError: isTagalog
      ? (isTablet
          ? "Hindi ma-access ang camera. Pumunta sa Settings > Privacy > Camera para payagan ang browser."
          : "Hindi ma-access ang camera. Pakisuri ang permiso at koneksyon.")
      : (isTablet
          ? "Camera access denied. Go to Settings › Privacy › Camera and allow your browser."
          : "Unable to access camera. Please check permissions and connection."),
    retry: isTagalog ? "Subukan muli" : "Try Again",
    back: isTagalog ? "← Balik" : "← Back",
  };

  const FINAL_MOTION_CAPTURE_SECONDS = 5;

  // Prefer per-event countdown; for retake, keep retakeIndices.length
  const cfgCountdown = event?.settings?.countdown ?? countdownSeconds;

  // Always take enough shots to fill all primary (non-clone) template slots.
  const templateSlotCount = primaryGuide.slots.length;
  const cfgShots = retakeIndices
    ? retakeIndices.length
    : Math.max(event?.settings?.numberOfShots ?? numberOfShots, templateSlotCount);



  /* ------------------------------------------------------------------ */
  /* Countdown logic                                                    */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!previewReady || isCapturing || photosTaken >= cfgShots) return;

    if (timer <= 0) {
      capturePhoto();
      return;
    }

    const id = setInterval(() => {
      setTimer((t) => (t > 0 ? t - 1 : 0));
    }, 1000);

    return () => clearInterval(id);
  }, [timer, previewReady, isCapturing, photosTaken, cfgShots]);

  useEffect(() => {
    if (!previewReady || isCapturing) return;
    if (photosTaken >= cfgShots) return;
    if (timer > FINAL_MOTION_CAPTURE_SECONDS) return;

    // prevent duplicate recorder
    if (activeRecorderRef.current) return;

    const targetIndex = retakeIndices ? retakeIndices[photosTaken] : null;
    const slotIdx = targetIndex ?? photosTaken;

    startPreShotRecording(slotIdx, sessionIdRef.current);
  }, [timer, previewReady, isCapturing, photosTaken, cfgShots, retakeIndices]);

  /* ------------------------------------------------------------------ */
  /* Capture helpers                                                    */
  /* ------------------------------------------------------------------ */
  const triggerFlash = () =>
    new Promise((res) => {
      if (!flashEnabled) return res(); // skip visual flash
      setIsFlashing(true);
      setTimeout(() => {
        setIsFlashing(false);
        res();
      }, 180);
    });

  const playShutter = () => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.13);
      osc.onended = () => ctx.close().catch(() => { });
    } catch { }
  };

  const captureFrame = async (targetIndex = null) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    // With the USB camera's live view running, a shot it missed is taken from its
    // last frame: same framing as the photos around it, and no webcam needed.
    const liveView = usbPreviewActive ? usbPreviewCanvasRef.current : null;
    const video = videoRef.current;
    const fromLiveView = !!liveView?.width;
    const source = fromLiveView ? liveView : video;
    if (!source) return null;

    const sourceW = fromLiveView ? liveView.width : (video.videoWidth || 1920);
    const sourceH = fromLiveView ? liveView.height : (video.videoHeight || 1080);

    // ✅ Capture the full camera frame only
    canvas.width = sourceW;
    canvas.height = sourceH;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (effectiveMirrorCamera && !fromLiveView) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(source, 0, 0, sourceW, sourceH, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    return {
      dataUrl,
      index: targetIndex ?? photosTaken,
      width: sourceW,
      height: sourceH,
      source: fromLiveView ? "liveview" : "webcam",
    };
  };

  const startPreShotRecording = (slotIndex, sessionId) => {
    try {
      if (usbPreviewActive && !usbPreviewStreamRef.current && usbPreviewCanvasRef.current?.captureStream) {
        usbPreviewStreamRef.current = usbPreviewCanvasRef.current.captureStream(15);
      }
      const stream = (usbPreviewActive && usbPreviewStreamRef.current) || streamRef.current;
      console.log("[startPreShotRecording]", { slotIndex, sessionId, hasStream: !!stream });
      if (!stream || !sessionId) return;

      if (activeRecorderRef.current) return; // prevent duplicate

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
          ? "video/webm;codecs=vp8"
          : "video/webm";

      // Each recording owns its chunk array — stored inside the ref alongside the
      // recorder so onstop can't accidentally clear a later recording's chunks.
      const chunks = [];

      const rec = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
      });

      rec.ondataavailable = (e) => {
        if (e.data?.size) chunks.push(e.data);
      };

      activeRecorderRef.current = { rec, sessionId, slotIndex, chunks };

      rec.start(250); // collect chunks every 250ms
    } catch (err) {
      console.error("[startPreShotRecording] failed:", err);
    }
  };

  const stopPreShotRecording = () => {
    const active = activeRecorderRef.current;
    console.log("[stopPreShotRecording]", active ? { slotIndex: active.slotIndex, sessionId: active.sessionId, chunks: active.chunks.length } : "no_active_recorder");
    if (!active) return Promise.resolve({ ok: false, reason: "no_active_recorder" });

    const { rec, sessionId, slotIndex, chunks } = active;

    // Release the ref immediately so the next slot's startPreShotRecording
    // is not blocked while this slot's onstop fires asynchronously.
    activeRecorderRef.current = null;

    return new Promise((resolve) => {
      rec.onstop = async () => {
        try {
          const mimeType = rec.mimeType || chunks[0]?.type || "video/webm";
          const blob = new Blob(chunks, { type: mimeType });

          console.log("[stopPreShotRecording] onstop", { slotIndex, sessionId, blobSize: blob.size, chunkCount: chunks.length });

          if (!blob.size) {
            return resolve({ ok: false, reason: "empty_blob" });
          }

          const ab = await blob.arrayBuffer();

          const res = await window.api.previewSaveSlotClip(
            sessionId,
            slotIndex,
            new Uint8Array(ab),
            { eventId }
          );

          console.log("[stopPreShotRecording] saveSlotClip result", { slotIndex, ok: res?.ok, error: res?.error });
          resolve(res?.ok ? { ok: true } : { ok: false, reason: res?.error || "save_failed" });
        } catch (err) {
          console.error("[stopPreShotRecording] failed:", err);
          resolve({ ok: false, reason: err?.message || "stop_failed" });
        }
      };

      try {
        if (rec.state === "recording") {
          rec.requestData();
          setTimeout(() => {
            try {
              if (rec.state !== "inactive") rec.stop();
              else resolve({ ok: false, reason: "already_inactive" });
            } catch (err) {
              resolve({ ok: false, reason: err?.message || "stop_failed" });
            }
          }, 60);
        } else {
          resolve({ ok: false, reason: "not_recording" });
        }
      } catch (err) {
        resolve({ ok: false, reason: err?.message || "requestdata_failed" });
      }
    });
  };

  const capturePhoto = async () => {
    if (isCapturing) return;
    setIsCapturing(true);

    try {
      await triggerFlash();
      playShutter();

      const targetIndex = retakeIndices ? retakeIndices[photosTaken] : null;
      const slotIdx = targetIndex ?? photosTaken;

      // Stop clip saving in the background — do NOT block still capture
      const clipPromise = stopPreShotRecording();
      pendingClipPromisesRef.current.push(clipPromise);

      let saved = null;
      let usbFailure = null;
      if (useUsbCamera && session?.sessionId) {
        const resumeLiveView = pauseUsbLiveView();
        const shot = await usbCameraApi
          .captureStill({ sessionId: session.sessionId, slotIndex: slotIdx, eventId })
          .catch((err) => ({ ok: false, error: { code: "IPC_FAILED", message: err?.message } }))
          .finally(() => resumeLiveView());
        if (shot?.ok && shot.dataUrl) {
          saved = {
            dataUrl: shot.dataUrl,
            index: targetIndex ?? photosTaken,
            width: shot.width,
            height: shot.height,
          };
        } else {
          usbFailure = shot?.error || { code: "UNKNOWN", message: null };
          console.warn("[PhotoScreen] USB camera shot failed; using the live view frame or webcam for this shot:", shot?.error?.code, shot?.error?.message);
        }
      }
      if (!saved) saved = await captureFrame(targetIndex);

      // Tell the dashboard where this photo came from, so missed camera shots are
      // visible to the operator and not only in the photos.
      if (useUsbCamera && session?.sessionId && saved) {
        usbCameraApi.recordShot?.({
          source: usbFailure ? (saved.source || "webcam") : "camera",
          code: usbFailure?.code ?? null,
          message: usbFailure?.message ?? null,
        })?.catch?.(() => { });
      }

      if (saved) {
        capturesRef.current.push(
          retakeIndices ? { index: targetIndex, saved } : saved
        );

        onCapture(saved);

        try {
          await window.api.previewSaveStill(session?.sessionId, slotIdx, saved.dataUrl, {
            eventId,
          });
        } catch { }
      }

      const nextShotIndex = photosTaken + 1;

      if (nextShotIndex < cfgShots) {
        const nextTargetIndex = retakeIndices
          ? retakeIndices[nextShotIndex] ?? nextShotIndex
          : nextShotIndex;

        setTimer(cfgCountdown);
      } else {
        setTimeout(async () => {
          try {
            await Promise.allSettled(pendingClipPromisesRef.current);
          } finally {
            pendingClipPromisesRef.current = [];
            onFinish(capturesRef.current);
            capturesRef.current = [];
          }
        }, 200);
      }

      setPhotosTaken(nextShotIndex);
    } catch (err) {
      console.error(err);
    } finally {
      setIsCapturing(false);
    }
  };

  const getGuideBoxByOrientation = (containerW, containerH, targetAspect) => {
    if (!containerW || !containerH || !targetAspect) {
      return { left: 0, top: 0, width: containerW || 0, height: containerH || 0 };
    }

    const isLandscapeGuide = targetAspect >= 1;
    const scale = 0.78; // within your requested 70–80%

    if (isLandscapeGuide) {
      // full width, reduced centered height
      const width = containerW;
      const height = Math.min(containerH * scale, width / targetAspect);
      return {
        width,
        height,
        left: 0,
        top: (containerH - height) / 2,
      };
    }

    // portrait guide: full height, reduced centered width
    const height = containerH;
    const width = Math.min(containerW * scale, height * targetAspect);
    return {
      width,
      height,
      left: (containerW - width) / 2,
      top: 0,
    };
  };

  const fittedGuideBox = getGuideBoxByOrientation(
    previewRect.width,
    previewRect.height,
    guideAspect
  );

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */
  if (isUnsupported) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center text-center gap-6" style={{ backgroundColor: bgColor }}>
        <p style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(22px, 3vw, 56px)', fontWeight: 'bold' }}>Display Not Supported</p>
        <p style={{ fontFamily: generalFont, color: generalFontColor, fontSize: 'clamp(14px, 1.8vw, 34px)' }}>Minimum resolution: 1080 × 1920 (Full HD portrait)</p>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-screen overflow-hidden"
      style={{
        backgroundColor: bgColor,
        fontFamily: generalFont,
        color: generalFontColor,
      }}
    >

      {/* Portrait: inline header overlaid at top */}
      {isPortrait && (
        <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between" style={{ padding: '2vh 4vw' }}>
          {logoPath
            ? <img src={normalizeToFileUrl(logoPath)} alt="logo" style={{ maxHeight: `${Math.round(60 * logoScale)}px` }} className="w-auto object-contain" />
            : <span className="font-bold" style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(18px, 2.5vw, 46px)' }}>{boothName}</span>
          }
          <div className="px-5 py-2 rounded-full font-bold backdrop-blur" style={{ backgroundColor: buttonBgColor, color: buttonFontColor, fontFamily: generalFont, fontSize: 'clamp(16px, 2vw, 38px)' }}>
            {photosTaken}/{cfgShots} {t.counter}
          </div>
        </div>
      )}

      {/* Landscape: separate logo + counter elements */}
      {!isPortrait && (<>
        <div className="absolute top-6 left-6 z-20">
          {logoPath ? (<img src={normalizeToFileUrl(logoPath)} alt="logo" style={{ maxWidth: `${Math.round(280 * logoScale)}px` }} className="object-contain" />) : (<>
            <h1 className="font-bold" style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(22px, 3.5vw, 56px)' }}><span>{boothName}</span></h1>
            {tagline && <p style={{ color: generalFontColor, fontSize: 'clamp(12px, 1.4vw, 22px)' }}>{tagline}</p>}
          </>)}
        </div>
        <div className="absolute top-6 right-6 z-20 rounded-full backdrop-blur font-bold" style={{ fontFamily: generalFont, color: buttonFontColor, background: buttonBgColor, fontSize: 'clamp(14px, 1.8vw, 26px)', padding: 'clamp(6px, 0.8vh, 12px) clamp(12px, 1.5vw, 24px)' }}>
          {photosTaken}/{cfgShots} {t.counter}
        </div>
      </>)}

      {/* Camera block */}
      <div className="absolute inset-0 z-0">
        <div
          ref={previewWrapRef}
          className="relative w-full h-full overflow-hidden bg-black"
        >
          <div className="relative w-full h-full overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 w-full h-full object-cover ${effectiveMirrorCamera ? "scale-x-[-1]" : ""} ${usbPreviewActive ? "invisible" : ""}`}
            />
            {useUsbCamera && (
              <canvas
                ref={usbPreviewCanvasRef}
                className={`absolute inset-0 w-full h-full object-cover ${effectiveMirrorCamera ? "scale-x-[-1]" : ""} ${usbPreviewActive ? "" : "invisible"}`}
              />
            )}
          </div>

          {/* Countdown: a single premium-white numeral, readable over any
              scene thanks to a soft shadow. Each second settles in from
              slightly larger. */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-live="polite">
            {timer > 0 && (
              <motion.span
                key={timer}
                initial={{ opacity: 0, scale: 1.35 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                className="select-none tabular-nums"
                style={{
                  // The booth's own font, as the rest of this screen uses; the
                  // event's header font is often decorative and makes numerals odd.
                  fontFamily: generalFont,
                  fontSize: "clamp(96px, 18vw, 260px)",
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: "-0.04em",
                  color: "#ffffff",
                  textShadow: "0 2px 4px rgba(0,0,0,0.22), 0 8px 28px rgba(0,0,0,0.28)",
                }}
              >
                {timer}
              </motion.span>
            )}
          </div>


          {/* Flash overlay */}
          <div
            className={`absolute inset-0 bg-white transition-opacity ${isFlashing ? "opacity-90" : "opacity-0"
              }`}
          />

          {/* After the last shot the booth finishes saving each pose's clip
              before moving on, which takes a few seconds. Say so, instead of
              leaving guests looking at a still camera. */}
          {photosTaken >= cfgShots && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.25 }}
              className="absolute inset-0 z-30 flex items-center justify-center"
              style={{ backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}
              aria-live="polite"
            >
              <div className="flex flex-col items-center text-center" style={{ padding: "0 8vw" }}>
                <div className="flex items-center gap-3 mb-6">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="rounded-full animate-bounce"
                      style={{ width: 14, height: 14, backgroundColor: "#ffffff", animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
                <div
                  style={{
                    fontFamily: generalFont,
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: "clamp(24px, 4vw, 56px)",
                    lineHeight: 1.15,
                    textShadow: "0 2px 12px rgba(0,0,0,0.35)",
                  }}
                >
                  {t.preparingTitle}
                </div>
                <div
                  style={{
                    marginTop: 10,
                    fontFamily: generalFont,
                    color: "rgba(255,255,255,0.85)",
                    fontSize: "clamp(14px, 1.8vw, 26px)",
                  }}
                >
                  {t.preparingBody}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Camera error display + action row */}
      {cameraError && !usbPreviewActive && (
        <div className="absolute inset-x-0 top-28 z-40 flex flex-col items-center">
          <div className="px-4 py-2 rounded-full bg-red-600/80 text-white text-sm shadow">
            {t.cameraError}
          </div>
          <div className="mt-4 flex gap-8">
            <button
              onClick={() => {
                setCameraError(null);
                setCameraReady(false);
                initCamera();
              }}
              className="px-6 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-gray-100"
            >
              {t.retry}
            </button>
            <button
              onClick={onCancel}
              className="px-6 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-gray-100"
            >
              {t.back}
            </button>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

    </div>
  );
}
