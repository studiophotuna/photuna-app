// Renders poster.html to PNG at exact pixel sizes using the Electron that
// already ships with this project — no puppeteer, no image library, and full
// CSS/webfont fidelity because it is real Chromium.
//
//   env -u ELECTRON_RUN_AS_NODE npx electron marketing/promo/render.js
//
// ELECTRON_RUN_AS_NODE is set in some shells here; with it set, require("electron")
// hands back the binary path instead of the API and `app` is undefined.
//
// Two things that otherwise silently corrupt the output:
//
//   * A visible window is clamped to the physical display and multiplied by its
//     DPI scale — a 1080x1350 request came back as 2160x1904, wrong on both
//     axes. Offscreen rendering is not bound by the display, and
//     force-device-scale-factor=1 keeps one CSS pixel as one PNG pixel.
//   * Playfair Display arrives over the network. Capturing before
//     document.fonts.ready bakes the fallback serif into the artwork, which is
//     easy to miss, so the face is asserted after each render.

const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const HTML = path.join(__dirname, "poster.html").replace(/\\/g, "/");
const OUT = __dirname;
// Bundled with the project already; used only to rotate the tall render back.
const FFMPEG = path.join(__dirname, "..", "..", "node_modules", "ffmpeg-static", "ffmpeg.exe");

const FORMATS = [
  { key: "square",   w: 1080, h: 1080, name: "photuna-promo-1x1-facebook-instagram.png" },
  { key: "portrait", w: 1080, h: 1350, name: "photuna-promo-4x5-instagram-feed.png" },
  { key: "story",    w: 1080, h: 1920, name: "photuna-promo-9x16-stories-reels-tiktok.png", rotate: true },
];

app.disableHardwareAcceleration();
// One CSS pixel to one PNG pixel. The tall format cannot be captured directly
// because a window is clamped to the display work area (1904px here, 16px shy
// of 1920), so it is rendered on its side in a landscape window and rotated
// back with ffmpeg.
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("force-color-profile", "srgb");
app.commandLine.appendSwitch("disable-lcd-text");

// Destroying the only window fires window-all-closed, which quits the app by
// default on Windows — so the loop rendered the first format and then exited
// silently. Hold the app open until the loop itself is finished.
app.on("window-all-closed", () => {});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function render({ key, w, h, name, rotate }) {
  const win = new BrowserWindow({
    width: rotate ? h : w,
    height: rotate ? w : h,
    show: false,
    frame: false,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      // Offscreen pages are throttled to this; a low rate is plenty for a
      // still and keeps the frame budget off the CPU.
      offscreenUseSharedTexture: false,
    },
  });
  win.webContents.setFrameRate(10);

  // Keep the most recent frame rather than the first: the first paint can
  // land before webfonts and shadows have composited.
  let latest = null;
  win.webContents.on("paint", (_e, _dirty, image) => { latest = image; });

  await win.loadURL(`file://${HTML}?format=${key}&w=${w}&h=${h}&rot=${rotate ? 1 : 0}`);

  await win.webContents
    .executeJavaScript("document.fonts.ready.then(() => true)")
    .catch(() => {});
  await wait(1500);

  const fontOk = await win.webContents
    .executeJavaScript("document.fonts.check('900 italic 100px \"Playfair Display\"')")
    .catch(() => false);

  // Nudge a repaint now that everything is settled, then take what comes back.
  win.webContents.invalidate();
  await wait(900);

  let image = latest;
  if (!image || image.isEmpty()) image = await win.webContents.capturePage();

  let png = image.toPNG();
  const raw = image.getSize();
  win.destroy();

  const dest = path.join(OUT, name);
  if (rotate) {
    // transpose=2 is 90 degrees counter-clockwise, undoing the CSS rotation.
    const tmp = path.join(OUT, ".rot-" + name);
    fs.writeFileSync(tmp, png);
    const { execFileSync } = require("child_process");
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", tmp, "-vf", "transpose=2", dest]);
    fs.unlinkSync(tmp);
    png = fs.readFileSync(dest);
  } else {
    fs.writeFileSync(dest, png);
  }

  const size = rotate ? { width: raw.height, height: raw.width } : raw;
  const exact = size.width === w && size.height === h;
  console.log(
    `${name.padEnd(48)} ${String(size.width) + "x" + String(size.height)}`.padEnd(62) +
    `${(png.length / 1024).toFixed(0)} KB  ` +
    `size:${exact ? "exact" : "WRONG (wanted " + w + "x" + h + ")"}  ` +
    `playfair:${fontOk ? "ok" : "FALLBACK"}`
  );
  return { name, exact, fontOk };
}

app.whenReady().then(async () => {
  const results = [];
  for (const f of FORMATS) {
    try {
      results.push(await render(f));
    } catch (err) {
      console.error(`FAILED ${f.name}: ${err.message}`);
      results.push({ name: f.name, exact: false, fontOk: false });
    }
    // A beat between windows; back-to-back create/destroy produced an
    // intermittent ERR_FAILED on the following load.
    await wait(600);
  }
  const bad = results.filter((r) => !r.exact || !r.fontOk);
  console.log(bad.length ? `\n${bad.length} render(s) need attention.` : "\nAll renders exact, correct face.");
  app.quit();
});
