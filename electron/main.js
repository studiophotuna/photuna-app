// electron/main.js
const { app, BrowserWindow, ipcMain, protocol, session } = require("electron");
const path = require("path");
const fs = require("fs");
const keytar = require('keytar');
const { autoUpdater } = require("electron-updater");
const fsp = fs.promises;
const { pathToFileURL, fileURLToPath } = require("url");
const { execFile } = require("child_process");
const store = require("./store");
const os = require("os");
const fssync = require("fs");
const express = require('express');
const mime = require('mime');
const { HealthMonitor } = require('./healthMonitor');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
function resolveExecutablePath(executablePath) {
  const raw = String(executablePath || "");
  if (!raw) return raw;
  return raw.includes("app.asar")
    ? raw.replace("app.asar", "app.asar.unpacked")
    : raw;
}
ffmpeg.setFfmpegPath(resolveExecutablePath(ffmpegPath));
const crypto = require('crypto');
const fsExtra = require('fs-extra');
const isDev = process.env.NODE_ENV === "development" || process.env.ELECTRON_START_URL;
const APP_NAME = "Studio Photuna Booth App";
const APP_VERSION = app.getVersion();
const APP_AUTHOR = "Photuna LLC";
const APP_WEBSITE = "https://www.studiophotuna.com";
let mainWindow = null;
const APP_SUPPORT_EMAIL = "";
const APP_COPYRIGHT_YEAR = "2024";
const APP_FULL_NAME = `${APP_NAME} v${APP_VERSION}`;
const APP_USER_AGENT = `${APP_NAME}/${APP_VERSION} (${os.type()} ${os.arch()} ${os.release()})`;
const APP_DATA_DIR = app.getPath("userData");
const APP_IS_DEV = isDev;

function loadPrivateEnvironment() {
  const dotenv = require("dotenv");
  const candidates = [
    path.join(path.dirname(process.execPath || ""), ".env"),
    path.join(process.cwd(), ".env"),
    path.join(process.resourcesPath || "", ".env"),
    path.join(__dirname, "..", ".env"),
  ];

  const loaded = [];
  for (const envPath of candidates) {
    if (!envPath || !fs.existsSync(envPath)) continue;
    const result = dotenv.config({ path: envPath, override: true });
    if (!result.error) {
      console.log("[env] loaded private environment from", envPath);
      loaded.push(envPath);
    }
  }

  if (!loaded.length) {
    console.warn("[env] no .env file found for private app configuration");
    return null;
  }

  return loaded[0];
}

loadPrivateEnvironment();

const SESSION_SERVICE = 'StudioPhotunaSession';
const SESSION_ACCOUNT = 'default';
const LICENSE_KEY_SERVICE = 'StudioPhotunaLicenseKey';
const LICENSE_KEY_ACCOUNT = 'default';

// === Auth constants (ADDED) ===
const AUTH_SERVICE_NAME = "StudioPhotunaAuth";
const AUTH_LAST_USERNAME_KEY = "auth.lastUsername";

const PAYMONGO_SERVICE = "StudioPhotunaPayMongo";
const { PayMongoService, PaymentPollManager, GenericPollManager, XenditService, PayPalService, generateQrDataUrl, isTestMode } = require("./services/paymentService");

const { createClient } = require("@supabase/supabase-js");

const FINAL_MOTION_DURATION_SECONDS = 5;

function getPrivateConfigValue(key) {
  const value = process.env[key] ?? "";
  return typeof value === "string" ? value.trim() : value;
}

let supabaseAdmin = null;
let supabaseAdminCacheKey = "";
function createSupabaseAdmin() {
  const supabaseUrl = getPrivateConfigValue("SUPABASE_URL") || getPrivateConfigValue("REACT_APP_SUPABASE_URL");
  const supabaseServiceRoleKey = getPrivateConfigValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  const cacheKey = `${supabaseUrl}|${supabaseServiceRoleKey}`;
  if (!supabaseAdmin || supabaseAdminCacheKey !== cacheKey) {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    supabaseAdminCacheKey = cacheKey;
  }
  return supabaseAdmin;
}

function getSupabaseAdmin() {
  const client = createSupabaseAdmin();
  if (!client) {
    throw new Error(
      "Photuna account services are not configured on this build."
    );
  }
  return client;
}

function isSupabaseAdminConfigured() {
  return Boolean(
    (getPrivateConfigValue("SUPABASE_URL") || getPrivateConfigValue("REACT_APP_SUPABASE_URL")) &&
    getPrivateConfigValue("SUPABASE_SERVICE_ROLE_KEY")
  );
}

// Build an authenticated Supabase client using the user's JWT (no service-role key needed).
function getSupabaseWithToken(accessToken) {
  const supabaseUrl = getPrivateConfigValue("SUPABASE_URL") || getPrivateConfigValue("REACT_APP_SUPABASE_URL");
  const supabaseAnonKey = getPrivateConfigValue("REACT_APP_SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !accessToken) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const { Blob } = require("buffer");

const { uploadSessionImages } = require("./uploadSessionImages");

/* -------------------------------------------------------
 * Global safety for unhandled rejections (dev-friendly)
 * -----------------------------------------------------*/
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

/* -------------------------------------------------------
 * 📁 Base Paths
 * -----------------------------------------------------*/
const USERDATA = app.getPath("userData");
const USERS_DIR = path.join(USERDATA, "users"); // per-user root
ensureDir(USERS_DIR);

function getEffectiveStorageRoot(userId, storagePath) {
  const custom = String(storagePath || "").trim();
  if (custom) {
    ensureDir(custom);
    return custom;
  }

  const { base } = getPaths(userId);
  const fallback = path.join(base, "booth-output");
  ensureDir(fallback);
  return fallback;
}

function resolveBoothOutputDirs({ userId, eventId = "default", sessionId = "default", storagePath }) {
  const root = getEffectiveStorageRoot(userId, storagePath);
  const eventDir = path.join(root, "events", String(eventId));
  const sessionDir = path.join(eventDir, "sessions", String(sessionId));

  const dirs = {
    root,
    eventDir,
    sessionDir,
    capturesDir: path.join(sessionDir, "captures"),
    finalDir: path.join(sessionDir, "final"),
    burstDir: path.join(sessionDir, "burst"),
    printDir: path.join(sessionDir, "print"),
    metaFile: path.join(sessionDir, "session.json"),
  };

  Object.entries(dirs).forEach(([key, value]) => {
    if (key !== "metaFile" && value !== root) ensureDir(value);
  });

  if (!fs.existsSync(dirs.metaFile)) {
    writeJson(dirs.metaFile, {
      sessionId: String(sessionId),
      eventId: String(eventId),
      createdAt: new Date().toISOString(),
      captures: [],
      finals: [],
      burst: [],
      prints: [],
      slots: [],
    });
  }

  return dirs;
}

// ===== Preview/session paths (per user) =====
function getPreviewRoot(userId) {
  // users/<uid>/preview/sessions
  const { base } = getPaths(userId);
  const dir = path.join(base, 'preview', 'sessions');
  ensureDir(dir);
  return dir;
}
function getSessionDir(userId, sessionId) {
  return path.join(getPreviewRoot(userId), String(sessionId));
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}


async function transcodeSlotClip(videoDir, slotIndex) {
  // Resolve file system paths
  const rawFs = path.join(videoDir, `slot${slotIndex}_raw.webm`);
  const mp4Fs = path.join(videoDir, `slot${slotIndex}.mp4`);
  const palFs = path.join(videoDir, `slot${slotIndex}_palette.png`);
  const gifFs = path.join(videoDir, `slot${slotIndex}.gif`);

  // Validate before handing to ffmpeg — an empty/absent file produces a cryptic
  // "Invalid data found" error from ffmpeg rather than a useful message.
  const rawStat = fs.existsSync(rawFs) ? fs.statSync(rawFs) : null;
  if (!rawStat || rawStat.size < 50) {
    throw new Error(`slot${slotIndex}_raw.webm is missing or empty (${rawStat?.size ?? 0} bytes)`);
  }

  // FFmpeg needs forward slashes on Windows
  const toFF = p => p.replace(/\\/g, "/");

  const raw = toFF(rawFs);
  const mp4 = toFF(mp4Fs);
  const pal = toFF(palFs);
  const gif = toFF(gifFs);

  // Delete stale files (prevents Windows locking issues)
  for (const f of [mp4Fs, palFs, gifFs]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch { }
  }

  // 1️⃣ Generate MP4
  await new Promise((resolve, reject) => {
    ffmpeg(raw)
      .outputOptions([
        "-an",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "20",
        "-movflags", "+faststart",
        "-vsync", "cfr",
        "-r", "30",
      ])
      .videoFilters("scale=480:-2:flags=lanczos")
      .on("end", resolve)
      .on("error", reject)
      .save(mp4);
  });

  // 2️⃣ Generate palette PNG
  await new Promise((resolve, reject) => {
    ffmpeg(raw)
      .videoFilters("fps=12,scale=360:-2:flags=lanczos,palettegen")
      .on('end', resolve)
      .on('error', reject)
      .save(pal);
  });

  // Validate palette exists and is non-zero
  if (!fs.existsSync(palFs) || fs.statSync(palFs).size === 0) {
    throw new Error("Palette generation failed — palette file is empty");
  }

  // 3️⃣ Generate GIF (Windows-safe complexFilter)
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(raw)  // input 0: video
      .input(pal)  // input 1: palette
      .complexFilter([
        "[0:v] fps=12,scale=360:-2:flags=lanczos [x]",
        "[x][1:v] paletteuse=dither=bayer:bayer_scale=5"
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(gif);
  });

  return { raw: rawFs, mp4: mp4Fs, gif: gifFs };
}

function clamp01(n, fallback = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toEven(n, min = 2) {
  const v = Math.max(min, Math.round(Number(n) || min));
  return v % 2 === 0 ? v : v + 1;
}

function toSlotPixels(slot, canvasW, canvasH, frame = null) {
  const pad = Number(frame?.padding || 0);

  const innerX = pad;
  const innerY = pad;
  const innerW = Math.max(2, canvasW - pad * 2);
  const innerH = Math.max(2, canvasH - pad * 2);

  return {
    x: Math.round(innerX + clamp01(slot?.x) * innerW),
    y: Math.round(innerY + clamp01(slot?.y) * innerH),
    w: toEven(clamp01(slot?.w, 0.1) * innerW),
    h: toEven(clamp01(slot?.h, 0.1) * innerH),
    rotation: Number(slot?.rotation || 0),

    scale: Math.max(1, Number(slot?.transform?.scale || 1)),
    offsetX: Math.round(Number(slot?.transform?.offsetX || 0)),
    offsetY: Math.round(Number(slot?.transform?.offsetY || 0)),
  };
}

async function createAnimatedComposite({
  userId,
  eventId = "default",
  sessionId = "default",
  storagePath = "",
  layout,
  frameOverlayDataUrl = null,
  slotVideoMap = null,
  backgroundColor = "#ffffff",
  watermark = false,
}) {
  const { burstDir, finalDir, metaFile } = resolveBoothOutputDirs({
    userId,
    eventId,
    sessionId,
    storagePath,
  });

  const slots = Array.isArray(layout?.slots) ? layout.slots : [];
  if (!slots.length) {
    throw new Error("Missing layout slots for animated composite.");
  }

  const layoutKey = String(layout?.layoutKey || layout?.layout || "4x6").toLowerCase();

  const SHEET_4x6 = { w: 1200, h: 1800 };
  const SHEET_6x4 = { w: 1800, h: 1200 };
  const STRIP_2x6 = { w: 600, h: 1800 };
  const STRIP_6x2 = { w: 1800, h: 600 };

  const isTallStrip = layoutKey === "2x6";
  const isWideStrip = layoutKey === "6x2";
  const isStripLayout = isTallStrip || isWideStrip;

  // renderArea = the single strip area where slots are calculated
  const renderAreaW = isTallStrip
    ? STRIP_2x6.w
    : isWideStrip
      ? STRIP_6x2.w
      : toEven(Number(layout?.width) || 1200);

  const renderAreaH = isTallStrip
    ? STRIP_2x6.h
    : isWideStrip
      ? STRIP_6x2.h
      : toEven(Number(layout?.height) || 1800);

  // final output sheet
  const canvasW = isTallStrip
    ? SHEET_4x6.w
    : isWideStrip
      ? SHEET_6x4.w
      : renderAreaW;

  const canvasH = isTallStrip
    ? SHEET_4x6.h
    : isWideStrip
      ? SHEET_6x4.h
      : renderAreaH;

  const outputFs = path.join(finalDir, "final-motion-1.mp4");
  if (fs.existsSync(outputFs)) {
    try { fs.unlinkSync(outputFs); } catch { }
  }

  let overlayFs = null;
  if (frameOverlayDataUrl && String(frameOverlayDataUrl).startsWith("data:image/")) {
    overlayFs = writeDataUrlToFile(finalDir, "motion-frame-overlay.png", frameOverlayDataUrl);
  }

  const activeSlots = [];
  const resolvedSlotVideoMap = Array.isArray(slotVideoMap)
    ? slotVideoMap
    : Array.isArray(layout?.slotVideoMap)
      ? layout.slotVideoMap
      : [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];

    // Which original captured slot should be used for this final slot?
    const mappedSourceIndex =
      Number.isInteger(resolvedSlotVideoMap[i]) ? resolvedSlotVideoMap[i] : i;

    const candidates = [
      path.join(burstDir, `slot${mappedSourceIndex}.mp4`),
      path.join(burstDir, `slot${mappedSourceIndex}.webm`),
      path.join(burstDir, `slot${mappedSourceIndex}_raw.webm`),
    ];

    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) continue;

    activeSlots.push({
      inputIndex: activeSlots.length + 1,
      file,
      slot,
      px: toSlotPixels(slot, renderAreaW, renderAreaH, layout?.frame || null),
    });
  }

  if (!activeSlots.length) {
    throw new Error("No burst slot videos found to compose.");
  }

  const command = ffmpeg();

  const safeBg = String(backgroundColor || "#ffffff");
  command.input(`color=c=${safeBg}@0:s=${renderAreaW}x${renderAreaH}:d=${FINAL_MOTION_DURATION_SECONDS}`);
  command.inputFormat("lavfi");

  activeSlots.forEach(({ file }) => {
    command.input(file);
  });

  if (overlayFs && fs.existsSync(overlayFs)) {
    command.input(overlayFs);
  }

  const filters = [];
  let last = "[0:v]";

  activeSlots.forEach((entry, i) => {
    const inLabel = `[${entry.inputIndex}:v]`;
    const zoomed = `[s${i}a]`;
    const placed = `[s${i}b]`;
    const slotted = `[s${i}c]`;
    const rotated = `[s${i}d]`;
    const overlaid = `[s${i}e]`;

    const {
      x,
      y,
      w,
      h,
      rotation,
      scale = 1,
      offsetX = 0,
      offsetY = 0,
    } = entry.px;

    const radians = ((rotation || 0) * Math.PI) / 180;
    const zoomH = toEven(h * scale);

    // 1) fit by height first, matching preview behavior better than "increase"
    filters.push(
      `${inLabel}setpts=N/(30*TB),fps=30,trim=duration=${FINAL_MOTION_DURATION_SECONDS},scale=-2:${zoomH}${zoomed}`
    );

    // 2) create a working frame that is never smaller than the zoomed input
    const padW = `max(iw\\,${w})`;
    const padH = `max(ih\\,${h})`;
    const padX = `max(0\\,(ow-iw)/2+${offsetX})`;
    const padY = `max(0\\,(oh-ih)/2+${offsetY})`;

    filters.push(
      `${zoomed}pad=${padW}:${padH}:${padX}:${padY}:color=white@0${placed}`
    );

    // 3) crop the final slot window from the centered working frame
    const cropX = `max(0\\,(iw-${w})/2)`;
    const cropY = `max(0\\,(ih-${h})/2)`;

    filters.push(
      `${placed}crop=${w}:${h}:${cropX}:${cropY}${slotted}`
    );

    // 4) rotate if needed
    if (rotation) {
      filters.push(
        `${slotted}rotate=${radians}:fillcolor=none:ow=${w}:oh=${h}${rotated}`
      );
    } else {
      filters.push(`${slotted}null${rotated}`);
    }

    // 5) overlay and keep last frame
    filters.push(
      `${last}${rotated}overlay=${x}:${y}:eof_action=repeat:repeatlast=1${overlaid}`
    );

    last = overlaid;
  });

  if (overlayFs && fs.existsSync(overlayFs)) {
    const overlayInputIndex = activeSlots.length + 1;

    if (isStripLayout) {
      const stripFrameScaled = `[stripFrameScaled]`;
      const stripFramed = `[stripFramed]`;

      // Match final.png: overlay is drawn on the single strip first
      filters.push(
        `[${overlayInputIndex}:v]scale=${renderAreaW}:${renderAreaH}${stripFrameScaled}`,
        `${last}${stripFrameScaled}overlay=0:0${stripFramed}`
      );

      last = stripFramed;
    } else {
      const frameScaled = `[frameScaled]`;
      const finalOut = `[finalOut]`;

      filters.push(
        `[${overlayInputIndex}:v]scale=${canvasW}:${canvasH}${frameScaled}`,
        `${last}${frameScaled}overlay=0:0${finalOut}`
      );

      last = finalOut;
    }
  }

  if (isStripLayout) {
    const stripA = `[stripDupA]`;
    const stripB = `[stripDupB]`;
    const duplicated = `[duplicatedSheet]`;

    filters.push(
      `${last}split=2${stripA}${stripB}`
    );

    if (isTallStrip) {
      filters.push(
        `color=c=white:s=${canvasW}x${canvasH}:d=${FINAL_MOTION_DURATION_SECONDS}[stripSheetBase]`,
        `[stripSheetBase]${stripA}overlay=0:0[tmpStrip1]`,
        `[tmpStrip1]${stripB}overlay=${renderAreaW}:0${duplicated}`
      );
    } else if (isWideStrip) {
      filters.push(
        `color=c=white:s=${canvasW}x${canvasH}:d=${FINAL_MOTION_DURATION_SECONDS}[stripSheetBase]`,
        `[stripSheetBase]${stripA}overlay=0:0[tmpStrip1]`,
        `[tmpStrip1]${stripB}overlay=0:${renderAreaH}${duplicated}`
      );
    }

    // first move last to the duplicated sheet
    last = duplicated;

    // then add divider on the duplicated sheet
    const dividerOut = `[dividerOut]`;

    if (isTallStrip) {
      filters.push(
        `color=c=black@0.15:s=2x${canvasH}:d=${FINAL_MOTION_DURATION_SECONDS}[dividerLine]`,
        `${last}[dividerLine]overlay=${renderAreaW}:0${dividerOut}`
      );
    } else if (isWideStrip) {
      filters.push(
        `color=c=black@0.15:s=${canvasW}x2:d=${FINAL_MOTION_DURATION_SECONDS}[dividerLine]`,
        `${last}[dividerLine]overlay=0:${renderAreaH}${dividerOut}`
      );
    }

    last = dividerOut;
  }

  if (watermark) {
    const watermarkedOut = "[watermarkedOut]";
    const fontSize = Math.max(36, Math.round(Math.min(canvasW, canvasH) * 0.045));
    filters.push(
      `${last}drawtext=text='STUDIO PHOTUNA TRIAL':fontcolor=white@0.70:bordercolor=black@0.45:borderw=3:fontsize=${fontSize}:x=(w-text_w)/2:y=h-(text_h*2.2)${watermarkedOut}`
    );
    last = watermarkedOut;
  }

  await new Promise((resolve, reject) => {
    command
      .complexFilter(filters, last.replace(/^\[|\]$/g, ""))
      .outputOptions([
        `-t ${FINAL_MOTION_DURATION_SECONDS}`,
        "-an",
        "-r 30",
        "-c:v libx264",
        "-pix_fmt yuv420p",
        "-preset veryfast",
        "-crf 23",
        "-movflags +faststart",
      ])
      .on("start", (cmd) => console.log("[buildFinalMotion] ffmpeg:", cmd))
      .on("end", resolve)
      .on("error", reject)
      .save(outputFs);
  });

  const meta = readJson(metaFile, {});
  meta.animatedComposite = "final/final-motion-1.mp4";
  writeJson(metaFile, meta);

  return {
    ok: true,
    filePath: outputFs,
    fileUrl: toFileUrl(outputFs),
    relativeKey: "final/final-motion-1.mp4",
  };
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:(.+);base64,(.*)$/.exec(String(dataUrl || ""));
  if (!match) {
    throw new Error("Invalid data URL");
  }

  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function sourceToBuffer(src) {
  if (!src) throw new Error("Missing source");

  const value = String(src);

  // data URL
  if (value.startsWith("data:")) {
    return dataUrlToBuffer(value);
  }

  // app:// custom protocol — translate to filesystem path (app://assets/<relKey> → USERS_DIR/<relKey>)
  if (value.startsWith("app://assets/")) {
    const rel = sanitizeRelKey(value.slice("app://assets/".length));
    const filePath = path.normalize(path.join(USERS_DIR, rel));
    if (!filePath.startsWith(USERS_DIR)) throw new Error("Invalid app:// path traversal");
    const buffer = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType =
      ext === ".png" ? "image/png" :
        ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
          ext === ".webp" ? "image/webp" :
            ext === ".gif" ? "image/gif" :
              ext === ".mp4" ? "video/mp4" :
                ext === ".webm" ? "video/webm" :
                  "application/octet-stream";
    return { mime: mimeType, buffer };
  }

  // file URL or absolute path
  if (value.startsWith("file:") || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    const filePath = fromFileUrl(value);
    const buffer = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();

    const mimeType =
      ext === ".png" ? "image/png" :
        ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
          ext === ".webp" ? "image/webp" :
            ext === ".gif" ? "image/gif" :
              ext === ".mp4" ? "video/mp4" :
                ext === ".webm" ? "video/webm" :
                  "application/octet-stream";

    return { mime: mimeType, buffer };
  }

  // http/https
  const response = await fetch(value);
  if (!response.ok) {
    throw new Error(`Failed to fetch source: ${response.status} ${response.statusText}`);
  }

  const ab = await response.arrayBuffer();
  return {
    mime: response.headers.get("content-type") || "application/octet-stream",
    buffer: Buffer.from(ab),
  };
}

function toBlobLike({ buffer, mime }) {
  return new Blob([buffer], { type: mime || "application/octet-stream" });
}

function makeSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createOnlineGalleryInMain(payload = {}) {
  const userId = payload?.userId || getUserIdFromStore();
  const eventId = payload?.eventId || "default";
  const accessToken = payload?.accessToken || null;
  const sessionId =
    payload?.sessionId && payload.sessionId !== "default"
      ? payload.sessionId
      : makeSessionId();

  const slug = sessionId;

  // Prefer local file URL (smaller IPC payload) over the large data URL
  const composedSource =
    payload?.composedImageUrl ||
    payload?.composedImagePath ||
    payload?.composedImage;

  const srcType = !composedSource ? "none"
    : composedSource.startsWith("data:") ? "data-url"
    : composedSource.startsWith("file:") ? "file-url"
    : composedSource.startsWith("blob:") ? "blob-url"
    : composedSource.startsWith("http") ? "http-url"
    : "absolute-path";

  console.log("[gallery:create] composedSource", {
    type: srcType,
    length: composedSource?.length,
    prefix: composedSource?.substring(0, 80),
  });

  if (!composedSource) {
    throw new Error("No valid composed image found for upload.");
  }

  const finalBlob = toBlobLike(await sourceToBuffer(composedSource));
  console.log("[gallery:create] finalBlob built", { size: finalBlob?.size, type: finalBlob?.type });

  const photoSources = Array.isArray(payload?.photos) ? payload.photos.filter(Boolean) : [];
  console.log("[gallery:create] photoSources", photoSources.map((s) => ({
    type: !s ? "null" : s.startsWith("data:") ? "data-url" : s.startsWith("file:") ? "file-url" : s.startsWith("blob:") ? "blob-url" : s.startsWith("http") ? "http-url" : "path",
    prefix: s?.substring(0, 60),
  })));
  const photoBlobs = await Promise.all(
    photoSources.map(async (src) => {
      const file = await sourceToBuffer(src);
      return toBlobLike(file);
    })
  );

  const layoutForMotion =
    (payload?.layoutConfig && typeof payload.layoutConfig === "object" ? payload.layoutConfig : null) ||
    (payload?.layout && typeof payload.layout === "object" ? payload.layout : null) ||
    null;

  let finalVideoBlob = null;

  const hasSlots = Array.isArray(layoutForMotion?.slots) && layoutForMotion.slots.length > 0;
  const hasSlotVideos = Array.isArray(payload?.slotVideoMap) && payload.slotVideoMap.length > 0;

  console.log("[gallery:create] motion precheck", {
    hasSlots,
    slotCount: hasSlots ? layoutForMotion.slots.length : 0,
    hasSlotVideos,
    slotVideoMapCount: hasSlotVideos ? payload.slotVideoMap.length : 0,
  });

  if (hasSlots && hasSlotVideos) {
    try {
      const motionResult = await createAnimatedComposite({
        userId,
        eventId,
        sessionId,
        storagePath: payload?.storagePath || "",
        layout: layoutForMotion,
        frameOverlayDataUrl: payload?.frameOverlayDataUrl || null,
        slotVideoMap: payload?.slotVideoMap || [],
        backgroundColor: payload?.motionBackgroundColor || "#ffffff",
        watermark: Boolean(payload?.watermark),
      });

      console.log("[gallery:create] motionResult:", motionResult);

      if (motionResult?.ok) {
        const motionSrc =
          motionResult.filePath ||
          motionResult.fileUrl ||
          motionResult.appUrl;

        if (motionSrc) {
          const motionFile = await sourceToBuffer(motionSrc);
          finalVideoBlob = toBlobLike(motionFile);

          console.log("[gallery:create] finalVideoBlob built", {
            type: finalVideoBlob?.type,
            size: finalVideoBlob?.size,
          });
        } else {
          console.warn("⚠️ motionResult ok but no file path returned");
        }
      }
    } catch (err) {
      // Animated composite is optional — log and continue with static image only
      console.warn("[gallery:create] animated composite skipped:", err?.message || err);
    }
  } else if (hasSlots) {
    console.log("[gallery:create] slots present but no slot videos captured — skipping motion composite");
  }

  // Collect slot burst videos from the filesystem
  const burstVideoBlobs = [];
  try {
    const { burstDir } = resolveBoothOutputDirs({
      userId,
      eventId,
      sessionId,
      storagePath: payload?.storagePath || "",
    });
    if (fs.existsSync(burstDir)) {
      const slotCount = Array.isArray(layoutForMotion?.slots) ? layoutForMotion.slots.length : 0;
      const slotIndices = slotCount > 0
        ? Array.from({ length: slotCount }, (_, i) => i)
        : [];
      for (const idx of slotIndices) {
        const candidates = [
          path.join(burstDir, `slot${idx}.mp4`),
          path.join(burstDir, `slot${idx}.webm`),
          path.join(burstDir, `slot${idx}_raw.webm`),
        ];
        const file = candidates.find((p) => fs.existsSync(p));
        if (file) {
          try {
            const buf = await fsp.readFile(file);
            const ext = path.extname(file).toLowerCase();
            const mime = ext === ".mp4" ? "video/mp4" : ext === ".ogg" ? "video/ogg" : "video/webm";
            burstVideoBlobs.push(new Blob([buf], { type: mime }));
          } catch (readErr) {
            console.warn(`[gallery:create] failed to read burst slot ${idx}:`, readErr?.message);
          }
        }
      }
      console.log("[gallery:create] burst videos collected:", burstVideoBlobs.length);
    }
  } catch (burstErr) {
    console.warn("[gallery:create] burst video collection skipped:", burstErr?.message);
  }

  const supabaseAdminClient =
    getSupabaseWithToken(accessToken) || getSupabaseAdmin();

  const uploadResult = await uploadSessionImages({
    supabase: supabaseAdminClient,
    eventId,
    sessionId,
    finalBlob,
    finalVideoBlob,
    photoBlobs,
    burstVideoBlobs,
  });

  console.log("[gallery:create] uploadResult:", uploadResult);

  // Fetch plan-aware expiry from DB; falls back to 7 days if the RPC fails (e.g. free plan / no row)
  let expiresAt;
  try {
    const { data: expiryTs, error: expiryErr } = await supabaseAdminClient
      .rpc("gallery_default_expires_at", { p_user_id: userId });
    if (!expiryErr && expiryTs) {
      expiresAt = expiryTs;
    }
  } catch (_) { /* ignore, use fallback */ }
  if (!expiresAt) {
    expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }

  const galleryPayload = {
    slug,
    event_id: eventId,
    session_id: sessionId,
    owner_user_id: userId || null,
    final_url: uploadResult.finalUrl,
    final_video_url: uploadResult.finalVideoUrl ?? null,
    photo_urls: Array.isArray(uploadResult.photoUrls) ? uploadResult.photoUrls : [],
    burst_video_urls: Array.isArray(uploadResult.burstVideoUrls) ? uploadResult.burstVideoUrls : [],
    expires_at: expiresAt,
  };
  const galleryBaseUrl = "https://gallery.studiophotuna.com/gallery";
  const qrUrl = `${galleryBaseUrl}/${slug}`;
  let galleryWarning = null;

  const { error: galleryError } = await supabaseAdminClient.from("galleries")
    .upsert(galleryPayload, { onConflict: "slug" });

  if (galleryError) {
    galleryWarning = galleryError.message || "Unable to save gallery metadata";
    console.error("[gallery:create] metadata upsert failed:", galleryWarning);
    throw new Error(`Unable to save gallery metadata: ${galleryWarning}`);
  }

  return {
    ok: true,
    sessionId,
    slug,
    qrUrl,
    warning: galleryWarning,
    finalUrl: uploadResult.finalUrl ?? null,
    finalVideoUrl: uploadResult.finalVideoUrl ?? null,
    photoUrls: uploadResult.photoUrls ?? [],
  };
}

function getUserIdFromStore() {
  try {
    return (typeof store.get === 'function' ? store.get('auth.currentUserId') : null) || null;
  } catch { return null; }
}
function ensureUserDirs(userId) {
  const base = path.join(USERS_DIR, String(userId || 'anon'));
  const paths = {
    base,
    eventsFile: path.join(base, "events.json"),
    eventsDir: path.join(base, "events"),
    capturesDir: path.join(base, "captures"),
    templatesDir: path.join(base, "templates"),
    assetsDir: path.join(base, "assets"),
  };

  // ensure directories exist
  ensureDir(paths.base);
  ensureDir(paths.capturesDir);
  ensureDir(paths.templatesDir);
  ensureDir(paths.assetsDir);
  // ensure per-user events.json exists
  if (!fs.existsSync(paths.eventsFile)) {
    fs.writeFileSync(paths.eventsFile, JSON.stringify([], null, 2), "utf8");
  }
  return paths;
}

function getPaths(userId) {
  return ensureUserDirs(userId || getUserIdFromStore());
}

/* -------------------------------------------------------
 * 🧩 Utilities
 * -----------------------------------------------------*/
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Scoped: ensure per-user per-event capture folder
function ensureCaptureFolder(userId, eventId) {
  const { capturesDir } = getPaths(userId);
  const dir = path.join(capturesDir, String(eventId ?? "default"));
  ensureDir(dir);
  return dir;
}

function getEventDataFile(userId, eventId = "default") {
  const { eventsDir } = getPaths(userId);
  ensureDir(eventsDir);
  return path.join(eventsDir, `event_${eventId}.json`);
}

// Safer file:// URL (handles Windows/macOS/Linux)
function toFileUrl(absPath) {
  try {
    return pathToFileURL(absPath).href; // e.g., file:///C:/...  or  file:///Users/...
  } catch {
    // fallback (shouldn't be used normally)
    let normalized = String(absPath).replace(/\\/g, "/");
    if (!normalized.startsWith("/")) normalized = "/" + normalized;
    return encodeURI("file://" + normalized);
  }
}

function fromFileUrl(urlOrPath) {
  if (!urlOrPath) return urlOrPath;
  const s = String(urlOrPath);
  if (s.startsWith("file:")) {
    return fileURLToPath(s); // correct platform path
  }
  return s; // already a raw path
}

function sanitizeFilename(name) {
  return String(name || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
}

function mimeToExt(mime) {
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/svg+xml": ".svg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/ogg": ".ogv",
    "video/quicktime": ".mov",
  };
  return map[mime] || "";
}

function formatBytes(bytes = 0) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "Unknown";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function canWriteToDirectory(targetPath) {
  try {
    const testFile = path.join(
      targetPath,
      `.write-test-${process.pid}-${Date.now()}.tmp`
    );
    await fs.writeFile(testFile, "ok");
    await fs.unlink(testFile);
    return true;
  } catch {
    return false;
  }
}

async function getDirectoryStats(targetPath) {
  let fileCount = 0;
  let totalBytes = 0;

  async function walk(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        fileCount += 1;
        try {
          const stat = await fs.stat(fullPath);
          totalBytes += stat.size || 0;
        } catch {
          // ignore unreadable files
        }
      }
    }
  }

  await walk(targetPath);
  return { fileCount, totalBytes };
}

function writeDataUrlToFile(dir, filename, dataUrl) {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid data URL");

  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function getNativePrintHelperPath() {
  const exeName = process.platform === "win32"
    ? "photo-print-helper.exe"
    : "photo-print-helper";

  const appPath = app.getAppPath();
  const devRoot = path.resolve(__dirname, "..");

  const candidates = [
    // packaged build
    path.join(process.resourcesPath, exeName),
    path.join(process.resourcesPath, "bin", exeName),

    // app paths
    path.join(appPath, exeName),
    path.join(appPath, "bin", exeName),
    path.join(appPath, "electron", "bin", exeName),

    // development paths
    path.join(__dirname, exeName),
    path.join(__dirname, "bin", exeName),
    path.join(devRoot, exeName),
    path.join(devRoot, "bin", exeName),
    path.join(devRoot, "electron", "bin", exeName),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        console.log("Native print helper found:", candidate);
        return candidate;
      }
    } catch { }
  }

  console.error("Native print helper not found. Checked paths:", candidates);
  return null;
}

function mapLayoutToNativeMedia(layout) {
  const normalized = String(layout || "4x6").toLowerCase();
  switch (normalized) {
    case "6x4":
      return { media: "6x4", widthIn: 6, heightIn: 4, landscape: true };
    case "2x6":
      return { media: "2x6", widthIn: 2, heightIn: 6, landscape: false };
    case "6x2":
      return { media: "6x2", widthIn: 6, heightIn: 2, landscape: true };
    case "4x6":
    default:
      return { media: "4x6", widthIn: 4, heightIn: 6, landscape: false };
  }
}

function mapPaperSizeToNativeMedia(paperSize, fallbackLayout = "4x6") {
  const raw = String(paperSize || "").trim();
  const normalized = raw.toLowerCase().replace(/[×]/g, "x");

  switch (normalized) {
    case "4x6":
    case "photo 4x6":
    case "north america 4x6":
      return { media: raw, widthIn: 4, heightIn: 6, landscape: false };

    case "6x4":
    case "photo 6x4":
      return { media: raw, widthIn: 6, heightIn: 4, landscape: true };

    case "2x6":
    case "photo 2x6":
      return { media: raw, widthIn: 2, heightIn: 6, landscape: false };

    case "6x2":
    case "photo 6x2":
      return { media: raw, widthIn: 6, heightIn: 2, landscape: true };

    default:
      return {
        ...mapLayoutToNativeMedia(fallbackLayout),
        media: raw || mapLayoutToNativeMedia(fallbackLayout).media,
      };
  }
}

function runNativePrintHelper({
  filePath,
  printer,
  layout,
  paperSize,
  copies,
  colorMode,
  quality,
  orientation,
  duplexMode,
  dpi,
  usePrinterDefaults,
}) {
  return new Promise((resolve, reject) => {
    const helperPath = getNativePrintHelperPath();

    if (!helperPath) {
      reject(
        new Error(
          "Native print helper not found. Place photo-print-helper.exe in /electron/bin, /bin, or the packaged resources folder."
        )
      );
      return;
    }

    const mediaSpec = mapPaperSizeToNativeMedia(paperSize, layout);

    const args = [
      "--file", filePath,
      "--printer", String(printer || ""),
      "--layout", String(mediaSpec.media || layout || "4x6"),
      "--copies", String(Math.max(1, Number(copies) || 1)),
      "--color", String(colorMode || "color"),
      "--quality", String(quality || "standard"),
      "--orientation", String(
        orientation && orientation !== "auto"
          ? orientation
          : mediaSpec.landscape ? "landscape" : "portrait"
      ),
      "--duplex", String(duplexMode || "simplex"),
      "--dpi", String(Number(dpi) || 300),
      "--use-printer-defaults", usePrinterDefaults ? "true" : "false",
    ];

    execFile(helperPath, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message || "Native print helper failed"));
        return;
      }

      resolve({
        ok: true,
        helperPath,
        stdout,
        stderr,
      });
    }
    );
  });
}

function writeBytesToFile(baseDir, filename, bytes) {
  ensureDir(baseDir);
  const fullPath = path.join(baseDir, filename);
  fs.writeFileSync(fullPath, Buffer.from(bytes));
  return fullPath;
}

function sanitizeRelKey(rel) {
  // prevent traversal, normalize slashes
  const clean = String(rel || "").replace(/\\/g, "/").replace(/\.\./g, "");
  return clean.replace(/^\/+/, "");
}



// Build app:// URL for assets (mapped via custom protocol below)
function toAppUrl(relativeKey) {
  const rel = sanitizeRelKey(relativeKey);
  return `app://assets/${rel}`;
}

// Ensure DB file exists
// Legacy global file ensured above is replaced by per-user events.json created lazily in ensureUserDirs()
//try {
//  if (!fs.existsSync(DB_FILE)) {
//    ensureDir(path.dirname(DB_FILE));
//    fs.writeFileSync(DB_FILE, JSON.stringify([]), "utf-8");
//  }
//} catch (err) {
// console.error("Error ensuring DB file:", err);
//}

/* -------------------------------------------------------
 * ----------------- IPC HANDLERS (module-level) -----------------------
 * -----------------------------------------------------*/

/* --------------------
   Legacy Photo API
   -------------------- */
ipcMain.handle(
  "captured-photo",
  async (_event, { eventId = "default", sessionId = "default", photoData, userId = null, storagePath = "" }) => {
    try {
      const { capturesDir } = resolveBoothOutputDirs({ userId, eventId, sessionId, storagePath });
      const filename = `photo-${Date.now()}.png`;
      const fullPath = path.join(capturesDir, filename);
      fs.writeFileSync(fullPath, photoData, "base64");
      return toFileUrl(fullPath);
    } catch (err) {
      console.error("captured-photo error:", err);
      return { ok: false, error: String(err) };
    }
  }
);


ipcMain.handle("get-captured-photos",
  async (_event, eventIdOrOpts = "default", userId = null) => {
    const eventId = typeof eventIdOrOpts === 'string'
      ? eventIdOrOpts
      : (eventIdOrOpts?.eventId ?? "default");
    userId = typeof eventIdOrOpts === 'object'
      ? (eventIdOrOpts?.userId ?? userId)
      : userId;
    try {
      const folder = ensureCaptureFolder(userId, eventId);
      if (!fs.existsSync(folder)) return [];
      return fs
        .readdirSync(folder)
        .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
        .map((f) => toFileUrl(path.join(folder, f)));
    } catch (err) {
      console.error("get-captured-photos error:", err);
      return [];
    }
  }
);

ipcMain.handle("media:listCameras", async (event) => {
  // Use the renderer that called this
  return await event.sender.executeJavaScript(`
    navigator.mediaDevices.enumerateDevices()
      .then(devices =>
        devices
          .filter(d => d.kind === "videoinput")
          .map(d => ({
            id: d.deviceId,
            label: d.label || "Camera"
          }))
      )
  `);
});

ipcMain.handle("media:getCameraCapabilities", async (event, cameraId) => {
  const safeCameraId = JSON.stringify(String(cameraId || ""));

  return await event.sender.executeJavaScript(`
    (async () => {
      const cameraId = ${safeCameraId};
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera capture is not available in this renderer.");
      }

      const constraints = cameraId
        ? { video: { deviceId: { exact: cameraId } }, audio: false }
        : { video: true, audio: false };

      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("No video track was returned.");

        const capabilities =
          typeof track.getCapabilities === "function"
            ? track.getCapabilities()
            : {};
        const settings =
          typeof track.getSettings === "function"
            ? track.getSettings()
            : {};

        return {
          ok: true,
          deviceId: settings.deviceId || cameraId || null,
          label: track.label || "Camera",
          capabilities,
          settings,
        };
      } finally {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
      }
    })()
  `);
});

/* --------------------
   New Photo API (System A)
   -------------------- */

ipcMain.handle("output:build-final-motion", async (_event, payload = {}) => {
  try {
    const {
      eventId = "default",
      sessionId = "default",
      userId = null,
      storagePath = "",
      layout = null,
    } = payload || {};

    const result = await createAnimatedComposite({
      userId: userId || getUserIdFromStore(),
      eventId,
      sessionId,
      storagePath,
      layout,
      frameOverlayDataUrl: payload.frameOverlayDataUrl || null,
      slotVideoMap: payload.slotVideoMap || null,
      backgroundColor: payload.backgroundColor || "#ffffff",
    });

    return result;
  } catch (err) {
    console.error("output:build-final-motion error:", err);
    return { ok: false, error: err?.message || String(err) };
  }
});

async function handleCapturePhoto(event, payload) {
  try {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid payload for capture-photo");
    }

    const { dataUrl, index, eventId, sessionId = "default", userId, storagePath = "" } = payload || {};

    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
      throw new Error("Invalid dataUrl");
    }

    const idx =
      typeof index === "number" || typeof index === "string"
        ? String(index)
        : Date.now().toString();

    const { capturesDir } = resolveBoothOutputDirs({ userId, eventId, sessionId, storagePath });
    const baseDir = capturesDir;
    await fsp.mkdir(baseDir, { recursive: true });

    const matches = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!matches) {
      throw new Error("dataUrl is not a valid base64 image");
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");

    const ext = mimeToExt(mimeType) || ".png";
    const safeIndex = String(idx).padStart(2, "0");
    const filename = `capture_${safeIndex}${ext}`;
    const filePath = path.join(baseDir, filename);

    await fsp.writeFile(filePath, buffer);

    // update session.json
    const { metaFile } = resolveBoothOutputDirs({ userId, eventId, sessionId, storagePath });
    const meta = readJson(metaFile, {});
    meta.captures = Array.isArray(meta.captures) ? meta.captures : [];
    meta.captures.push({
      index: Number(idx),
      file: `captures/${filename}`,
      createdAt: new Date().toISOString(),
    });
    writeJson(metaFile, meta);

    return { ok: true, filePath, fileUrl: toFileUrl(filePath) };
  } catch (err) {
    console.error("capture-photo error:", err);
    return { ok: false, error: err.message || String(err) };
  }
};

ipcMain.handle(
  "captures:list",
  async (_event, { eventId = "default", sessionId = "default", userId, storagePath = "" } = {}) => {
    try {
      const { capturesDir } = resolveBoothOutputDirs({ userId, eventId, sessionId, storagePath });
      if (!fs.existsSync(capturesDir)) return [];

      const files = fs
        .readdirSync(capturesDir)
        .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
        .map((f) => path.join(capturesDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

      return files.map(toFileUrl);
    } catch (err) {
      console.error("captures:list error:", err);
      return [];
    }
  }
);

ipcMain.handle("output:save-final-png", async (_event, payload = {}) => {
  try {
    const {
      imageData,
      eventId = "default",
      sessionId = "default",
      userId,
      storagePath = "",
      filename,
    } = payload;

    if (!imageData || !String(imageData).startsWith("data:image/")) {
      throw new Error("Invalid final PNG data");
    }

    const { finalDir, metaFile } = resolveBoothOutputDirs({ userId, eventId, sessionId, storagePath });
    const safeName = sanitizeFilename(filename || `final_composed_${Date.now()}.png`);
    const savedPath = writeDataUrlToFile(finalDir, safeName, imageData);

    const meta = readJson(metaFile, {});
    meta.finals = Array.isArray(meta.finals) ? meta.finals : [];
    meta.finals.push({
      file: `final/${safeName}`,
      createdAt: new Date().toISOString(),
    });
    meta.finalPrint = `final/${safeName}`;
    writeJson(metaFile, meta);

    return { ok: true, savedPath, fileUrl: toFileUrl(savedPath) };
  } catch (err) {
    console.error("output:save-final-png error:", err);
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("output:save-print-copy", async (_event, payload = {}) => {
  try {
    const {
      imageData,
      eventId = "default",
      sessionId = "default",
      userId,
      storagePath = "",
      filename,
    } = payload;

    if (!imageData || !String(imageData).startsWith("data:image/")) {
      throw new Error("Invalid print PNG data");
    }

    const { printDir, metaFile } = resolveBoothOutputDirs({ userId, eventId, sessionId, storagePath });
    const safeName = sanitizeFilename(filename || `print_copy_${Date.now()}.png`);
    const savedPath = writeDataUrlToFile(printDir, safeName, imageData);

    const meta = readJson(metaFile, {});
    meta.prints = Array.isArray(meta.prints) ? meta.prints : [];
    meta.prints.push({
      file: `print/${safeName}`,
      createdAt: new Date().toISOString(),
    });
    writeJson(metaFile, meta);

    return { ok: true, savedPath, fileUrl: toFileUrl(savedPath) };
  } catch (err) {
    console.error("output:save-print-copy error:", err);
    return { ok: false, error: String(err) };
  }
});

/* --------------------
   Aliases (compatibility)
   -------------------- */
ipcMain.handle("capture-photo", handleCapturePhoto);
ipcMain.handle("capturePhoto", handleCapturePhoto); // alias

ipcMain.handle("getCapturedPhotos", async (_evt, eventIdOrArg) => {
  const eventId = typeof eventIdOrArg === "string"
    ? eventIdOrArg
    : (eventIdOrArg?.eventId ?? "default");
  const userId = typeof eventIdOrArg === "object"
    ? eventIdOrArg?.userId ?? null
    : null;
  try {
    const folder = ensureCaptureFolder(userId, eventId);
    if (!fs.existsSync(folder)) return [];
    return fs
      .readdirSync(folder)
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .map(f => toFileUrl(path.join(folder, f)));
  } catch (err) {
    console.error("getCapturedPhotos error:", err);
    return [];
  }
});

/* -------------------------------------------------------
 * Events / Templates / Printing handlers (unchanged)
 * -----------------------------------------------------*/
ipcMain.handle("sync-event", async (_event, action) => {
  const { eventsFile } = getPaths(action?.userId);
  let events = [];
  try {
    events = JSON.parse(fs.readFileSync(eventsFile, "utf8"));
  } catch (err) {
    events = [];
  }

  switch (action.type) {
    case "add":
      events.push(action.event);
      break;
    case "update": {
      const idx = events.findIndex((e) => e.id === action.event.id);
      if (idx !== -1) events[idx] = action.event;
      else events.push(action.event);
      break;
    }
    case "delete":
      events = events.filter((e) => e.id !== action.eventId);
      break;
  }

  try {
    fs.writeFileSync(eventsFile, JSON.stringify(events, null, 2));
  } catch (err) {
    console.error("Failed to save per-user events.json:", err);
  }

  return { success: true };
});

// Deletes all Supabase storage objects and gallery rows for a deleted event.
// Fire-and-forget from the renderer — does not block the UI.
ipcMain.handle("event:cleanupStorage", async (_e, { eventId } = {}) => {
  if (!eventId) return { ok: false, reason: "no_event_id" };
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("delete_event_storage", { p_event_id: eventId });
    if (error) throw error;
    console.log(`[event:cleanupStorage] deleted ${data} storage objects for event ${eventId}`);
    return { ok: true, deleted: data };
  } catch (err) {
    console.error("[event:cleanupStorage] failed:", err);
    return { ok: false, reason: err?.message || "cleanup_failed" };
  }
});

ipcMain.handle("load-events", async (_e, { userId } = {}) => {
  try {
    const { eventsFile } = getPaths(userId);
    return JSON.parse(fs.readFileSync(eventsFile, "utf8"));
  } catch (err) {
    console.error("load-events error:", err);
    return [];
  }
});

/* Per-event data */
ipcMain.handle("save-event-data", async (_event, payload = {}) => {
  try {
    // Allow both legacy shape (data) and new shape ({ userId, ...data })
    const { userId, ...data } = payload;
    const uid = userId ?? getUserIdFromStore();
    const file = getEventDataFile(uid, data?.id ?? "default");
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error("save-event-data error:", err);
    return false;
  }
});

ipcMain.handle("get-event-data", async (_event, arg) => {
  try {
    // Support both legacy arg = "eventId" and new arg = { eventId, userId }
    const { eventId = "default", userId = null } =
      typeof arg === "object" ? (arg || {}) : { eventId: arg, userId: null };
    const uid = userId ?? getUserIdFromStore();
    const file = getEventDataFile(uid, eventId);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
    return null;
  } catch (err) {
    console.error("get-event-data error:", err);
    return null;
  }
});

/* Templates */
ipcMain.handle("template:get", async (_event, { eventId, userId } = {}) => {
  try {

    const { templatesDir } = getPaths(userId);
    const file = path.join(templatesDir, `template_${eventId}.json`);

    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    console.error("template:get error:", err);
  }
  return {
    id: "five-slot",
    name: "3 top + 2 bottom",
    slots: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }, { id: "s5" }],
  };
});

ipcMain.handle("template:saveSelection", async (_event, payload) => {
  try {
    const { eventId, userId } = payload || {};

    const { templatesDir } = getPaths(userId);
    ensureDir(templatesDir);
    const file = path.join(templatesDir, `selection_${eventId ?? "default"}.json`);

    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
    return { ok: true, file };
  } catch (err) {
    console.error("template:saveSelection error:", err);
    return { ok: false, error: String(err) };
  }
});

/* Printing */
ipcMain.handle("print-photo", async (event, {
  printer,
  imageData,
  layout = "4x6",
  printMode = "single",
  paperSize = "4x6",
  copies = 1,
  colorMode = "color",
  quality = "standard",
  orientation = "auto",
  duplexMode = "simplex",
  dpi = 300,
  usePrinterDefaults = false,
}) => {
  try {
    if (!printer) throw new Error("No printer name");
    if (!imageData || typeof imageData !== "string" || !imageData.startsWith("data:image")) {
      throw new Error("Invalid image");
    }

    const sender = BrowserWindow.fromWebContents(event.sender);
    const printers = await sender.webContents.getPrintersAsync();

    const normalizedLayout = String(layout || "4x6").toLowerCase();
    const isDualPrint = String(printMode || "single").toLowerCase() === "dual";
    const isStripLayout = normalizedLayout === "2x6" || normalizedLayout === "6x2" ||
      (normalizedLayout === "4x6" && isDualPrint);

    // Try exact printer first
    const exactPrinter =
      printers.find(p => p.name === printer || p.displayName === printer) || null;

    if (!exactPrinter) {
      throw new Error(`Requested printer not found: ${printer}`);
    }

    // Only use -STRIP if it actually exists
    let resolvedPrinter = exactPrinter.name;

    if (isStripLayout) {
      const stripName = `${exactPrinter.name}-STRIP`;
      const stripPrinter = printers.find(
        p => p.name === stripName || p.displayName === stripName
      );

      if (stripPrinter) {
        resolvedPrinter = stripPrinter.name;
      } else {
        console.warn(`Strip printer not found, falling back to base printer: ${stripName}`);
      }
    }

    const tempDir = path.join(app.getPath("temp"), "photuna-prints");
    const fileName = `photuna-${normalizedLayout}-${Date.now()}.png`;
    const samplePath = writeDataUrlToFile(tempDir, fileName, imageData);

    console.log("NATIVE ARTIFACT PRINT ----------------");
    console.log("Requested printer:", printer);
    console.log("Resolved printer:", resolvedPrinter);
    console.log("Layout:", normalizedLayout);
    console.log("Copies:", copies);
    console.log("Color mode:", colorMode);
    console.log("Quality:", quality);
    console.log("Orientation:", orientation);
    console.log("Duplex:", duplexMode);
    console.log("DPI:", dpi);
    console.log("Use printer defaults:", !!usePrinterDefaults);
    console.log("PNG path:", samplePath);

    const win = BrowserWindow.fromWebContents(event.sender);
    let progress = 0;
    // Simulate progress up to 90%; the final 100% fires only on confirmed success.
    // Capped so the bar never auto-completes before the helper finishes, and so a
    // failed job doesn't leave the bar at 100%.
    const interval = setInterval(() => {
      progress = Math.min(0.9, progress + 0.1);
      win.webContents.send('print-progress', progress);
    }, 1000);

    let nativeResult;
    try {
      nativeResult = await runNativePrintHelper({
        filePath: samplePath,
        printer: resolvedPrinter,
        layout: normalizedLayout,
        paperSize: paperSize,
        copies,
        colorMode,
        quality,
        orientation,
        duplexMode,
        dpi,
        usePrinterDefaults,
      });
    } catch (helperErr) {
      clearInterval(interval);
      try { fs.unlinkSync(samplePath); } catch {}
      throw helperErr;
    }

    clearInterval(interval);
    try { fs.unlinkSync(samplePath); } catch {}
    win.webContents.send('print-progress', 1);

    console.log("Native helper result:", nativeResult);

    return {
      ok: true,
      printer: resolvedPrinter,
      layout: normalizedLayout,
      samplePath,
      driver: "native-helper",
    };
  } catch (err) {
    console.error("print-photo failed:", err);
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
});

ipcMain.handle("gallery:create", async (_event, payload) => {
  try {
    if (!payload?.galleryEnabled && !payload?.galleryAddon) {
      return {
        ok: true,
        skipped: true,
        reason: "gallery_addon_disabled",
        qrUrl: null,
        finalUrl: payload?.composedImageUrl || null,
        finalVideoUrl: null,
      };
    }

    return await createOnlineGalleryInMain(payload);
  } catch (err) {
    console.error("[gallery:create] failed:", err);
    return {
      ok: false,
      error: err?.message || "Failed to create online gallery",
    };
  }
});

ipcMain.handle("gallery:get-event-sessions", async (_event, { eventId, userId } = {}) => {
  try {
    if (!eventId) return { ok: false, sessions: [], error: "eventId required" };
    const admin = getSupabaseAdmin();
    let query = admin
      .from("galleries")
      .select("slug, session_id, final_url, final_video_url, expires_at, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });
    if (userId) query = query.eq("owner_user_id", userId);
    const { data, error } = await query;
    if (error) return { ok: false, sessions: [], error: error.message };
    const galleryBaseUrl = "https://gallery.studiophotuna.com/gallery";
    return {
      ok: true,
      sessions: (data || []).map((row) => ({
        slug: row.slug,
        sessionId: row.session_id,
        qrUrl: `${galleryBaseUrl}/${row.slug}`,
        finalUrl: row.final_url,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      })),
    };
  } catch (err) {
    return { ok: false, sessions: [], error: err?.message || "Failed to fetch galleries" };
  }
});

// Create (or retrieve) a pre-session event-level gallery QR — no photos needed.
// Allows the admin to show clients a QR code before any sessions start.
ipcMain.handle("gallery:create-event-qr", async (_event, { eventId, userId } = {}) => {
  try {
    if (!eventId) return { ok: false, error: "eventId required" };
    const admin = getSupabaseAdmin();
    const galleryBaseUrl = "https://gallery.studiophotuna.com/gallery";

    // Look up the user's gallery tier so branding is not gated off
    let galleryTier = "free";
    if (userId) {
      const { data: lic } = await admin.from("licenses").select("gallery_tier, gallery_addon").eq("user_id", userId).maybeSingle();
      galleryTier = resolveGalleryTier(lic || {});
    }

    // Re-use an existing event-level entry if one already exists
    const { data: existing } = await admin
      .from("galleries")
      .select("slug, expires_at, gallery_tier")
      .eq("event_id", eventId)
      .is("session_id", null)
      .maybeSingle();

    if (existing?.slug) {
      // Patch gallery_tier if it was never set or is stale
      if (!existing.gallery_tier || existing.gallery_tier !== galleryTier) {
        await admin.from("galleries").update({ gallery_tier: galleryTier }).eq("event_id", eventId).is("session_id", null);
      }
      return {
        ok: true,
        slug: existing.slug,
        qrUrl: `${galleryBaseUrl}/${existing.slug}`,
        expiresAt: existing.expires_at,
        isNew: false,
      };
    }

    // Build a stable slug from the event id so it can be shared before any session
    const slug = `evt-${String(eventId).replace(/-/g, "").slice(0, 12)}-${Date.now().toString(36)}`;
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days

    const { error } = await admin.from("galleries").insert({
      slug,
      event_id: eventId,
      session_id: null,
      owner_user_id: userId || null,
      final_url: null,
      expires_at: expiresAt,
      gallery_tier: galleryTier,
    });

    if (error) return { ok: false, error: error.message };

    return {
      ok: true,
      slug,
      qrUrl: `${galleryBaseUrl}/${slug}`,
      expiresAt,
      isNew: true,
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Failed to create event gallery QR" };
  }
});

ipcMain.handle("get-printers", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win.webContents.getPrintersAsync();
});

ipcMain.handle("test-print", (event, printJob) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.webContents.print({ deviceName: printJob.printer, copies: printJob.copies || 1, silent: false });
});

// Listen for a hardware shutter press from the renderer
ipcMain.on('trigger-shutter', (event) => {
  // broadcast to all windows (could also call capture-photo directly)
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('trigger-shutter');
  });
});

// Relay eventsUpdated notifications (call this whenever your store updates events)
function broadcastEventsUpdated(payload) {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('eventsUpdated', payload);
  });
}

ipcMain.handle("app:clear-cache", async () => {
  try {
    await session.defaultSession.clearCache();
    return { ok: true, message: "Cache cleared successfully" };
  } catch (error) {
    console.error("app:clear-cache failed", error);
    return { ok: false, error: error.message || "Failed to clear cache" };
  }
});

ipcMain.handle("get-preview-slot-clips", async (event, { sessionId, options }) => {
  try {
    console.log("[MAIN] get-preview-slot-clips:", sessionId);

    const userId = getUserIdFromStore();

    const { burstDir } = resolveBoothOutputDirs({
      userId,
      eventId: options?.eventId || "default",
      sessionId,
      storagePath: "",
    });

    console.log("[MAIN] resolved burstDir:", burstDir);

    if (!fs.existsSync(burstDir)) {
      console.warn("[MAIN] burstDir does not exist:", burstDir);
      return [];
    }

    const files = await fs.promises.readdir(burstDir);

    const clips = files
      .filter((f) => f.endsWith(".webm") || f.endsWith(".mp4"))
      .map((file) => {
        const fullPath = path.join(burstDir, file);

        return {
          fileUrl: `file://${fullPath}`,
          path: fullPath,
        };
      });

    console.log("[MAIN] clips found:", clips);

    return clips;
  } catch (err) {
    console.error("[MAIN] getPreviewSlotClips error:", err);
    return [];
  }
});

ipcMain.handle("storage:info", async (_event, targetPath) => {
  try {
    if (!targetPath || typeof targetPath !== "string") {
      return {
        ok: false,
        error: "No storage path provided",
      };
    }

    const exists = await pathExists(targetPath);
    if (!exists) {
      return {
        ok: true,
        exists: false,
        writable: false,
        path: targetPath,
        message: "Folder does not exist",
      };
    }

    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      return {
        ok: true,
        exists: true,
        writable: false,
        path: targetPath,
        message: "Path is not a folder",
      };
    }

    const writable = await canWriteToDirectory(targetPath);

    let stats = { fileCount: 0, totalBytes: 0 };
    try {
      stats = await getDirectoryStats(targetPath);
    } catch {
      // keep fallback values
    }

    return {
      ok: true,
      exists: true,
      writable,
      path: targetPath,
      fileCount: stats.fileCount,
      totalBytes: stats.totalBytes,
      totalSize: formatBytes(stats.totalBytes),
      freeSpace: "Unknown",
      message: writable ? "Storage folder is ready" : "Storage folder is not writable",
    };
  } catch (error) {
    console.error("storage:info failed", error);
    return {
      ok: false,
      error: error.message || "Failed to inspect storage folder",
    };
  }
});

ipcMain.handle("storage:cleanup", async (_event, payload = {}) => {
  try {
    const targetPath = payload?.path;
    const autoDeleteDays = Number(payload?.autoDeleteDays ?? 0);

    if (!targetPath || typeof targetPath !== "string") {
      return {
        ok: false,
        error: "No storage path provided",
      };
    }

    if (!autoDeleteDays || autoDeleteDays <= 0) {
      return {
        ok: true,
        deletedCount: 0,
        message: "Auto cleanup is disabled",
      };
    }

    const exists = await pathExists(targetPath);
    if (!exists) {
      return {
        ok: false,
        error: "Storage folder does not exist",
      };
    }

    const cutoffMs = Date.now() - autoDeleteDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;
    let failedCount = 0;

    async function walkAndCleanup(currentPath) {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await walkAndCleanup(fullPath);
          continue;
        }

        if (!entry.isFile()) continue;

        try {
          const stat = await fs.stat(fullPath);
          const modifiedTime = stat.mtimeMs || 0;

          if (modifiedTime <= cutoffMs) {
            await fs.unlink(fullPath);
            deletedCount += 1;
          }
        } catch {
          failedCount += 1;
        }
      }
    }

    await walkAndCleanup(targetPath);

    return {
      ok: true,
      deletedCount,
      failedCount,
      message:
        deletedCount > 0
          ? `Cleanup completed. Deleted ${deletedCount} file${deletedCount === 1 ? "" : "s"}.`
          : "Cleanup completed. No files matched the cleanup rule.",
    };
  } catch (error) {
    console.error("storage:cleanup failed", error);
    return {
      ok: false,
      error: error.message || "Failed to clean storage folder",
    };
  }
});

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
let cleanupTimer = null;

async function runAutoStorageCleanup() {
  try {
    const userId = getUserIdFromStore();
    if (!userId) return;

    const settingsKey = `users.${userId}.settings`;
    const settings = typeof store.get === "function" ? store.get(settingsKey, {}) : {};
    const storagePath = String(settings?.storagePath || "").trim();
    const autoDeleteDays = Number(settings?.autoDeleteDays ?? 0);

    if (!storagePath || !autoDeleteDays || autoDeleteDays <= 0) return;

    const exists = await pathExists(storagePath);
    if (!exists) return;

    const cutoffMs = Date.now() - autoDeleteDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    async function walk(dir) {
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { await walk(fullPath); continue; }
        if (!entry.isFile()) continue;
        try {
          const stat = await fsp.stat(fullPath);
          if ((stat.mtimeMs || 0) <= cutoffMs) {
            await fsp.unlink(fullPath);
            deletedCount++;
          }
        } catch { /* skip files we can't stat/delete */ }
      }
    }

    await walk(storagePath);
    if (deletedCount > 0) {
      console.log(`[auto-cleanup] Deleted ${deletedCount} file(s) older than ${autoDeleteDays} day(s) from ${storagePath}`);
    }
  } catch (err) {
    console.warn("[auto-cleanup] failed:", err?.message);
  }
}

function scheduleAutoCleanup() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  // Run once shortly after startup, then repeat periodically
  setTimeout(() => runAutoStorageCleanup(), 10_000);
  cleanupTimer = setInterval(() => runAutoStorageCleanup(), CLEANUP_INTERVAL_MS);
}

ipcMain.handle("app:check-updates", async () => {
  try {
    if (isDev) {
      return {
        ok: true,
        hasUpdate: false,
        version: app.getVersion(),
        currentVersion: app.getVersion(),
        message: "Updates are only available in the installed (production) build. Run 'npm run dist:win' and install the .exe to test updates.",
      };
    }

    const ghToken = getPrivateConfigValue("GH_TOKEN") || getPrivateConfigValue("GITHUB_TOKEN");
    if (ghToken) {
      process.env.GH_TOKEN = ghToken;
    }

    const result = await autoUpdater.checkForUpdates();

    return {
      ok: true,
      hasUpdate: !!result?.updateInfo && result.updateInfo.version !== app.getVersion(),
      version: result?.updateInfo?.version || app.getVersion(),
      currentVersion: app.getVersion(),
      message: "Update check completed",
    };
  } catch (error) {
    console.error("[app:check-updates] error:", error?.message);
    return {
      ok: false,
      error: error?.message || "Failed to check for updates",
    };
  }
});

ipcMain.handle("app:download-update", async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Failed to download update",
    };
  }
});

ipcMain.handle("app:install-update", async () => {
  try {
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Failed to install update",
    };
  }
});

ipcMain.handle("printer:get-capabilities", async (event, printerName) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  const printers = await sender.webContents.getPrintersAsync();
  const printer = printers.find(p => p.name === printerName);

  if (!printer) throw new Error("Printer not found");

  const opts = printer.options || {};

  return {
    name: printer.name,
    displayName: printer.displayName || printer.name,
    description: printer.description || "",
    status: printer.status ?? null,
    isDefault: !!printer.isDefault,
    options: opts,

    // normalized values for your UI
    orientation:
      opts.orientation || null,

    paperSizes:
      opts.paperSizes || opts.supportedPaperSizes || [],

    colorModes:
      opts.color ? ["color", "grayscale"] : ["color", "grayscale"],

    qualities:
      opts.printQuality ? [opts.printQuality] : ["draft", "standard", "high"],

    duplexModes:
      ["simplex", "shortEdge", "longEdge"],

    dpi: {
      horizontal: Number(opts.horizontalDpi || opts.dpi || 300),
      vertical: Number(opts.verticalDpi || opts.dpi || 300),
    },
  };
});

/* -------------------------------------------------------
 * 🪟 Window Setup
 * -----------------------------------------------------*/
function createWindow() {

  const isDev =
    process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_START_URL;

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      ...(isDev ? {
        webSecurity: false,
        allowRunningInsecureContent: true,
        allowFileAccess: true,
      } : {})
    },
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Auto-restart on renderer crash
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[crash] Renderer process gone:", details.reason, details.exitCode);
    const autoRestart = store.get("settings")?.autoRestart
      ?? store.get(`users.${getUserIdFromStore()}.settings`)?.autoRestart
      ?? true;
    if (autoRestart && details.reason !== "clean-exit") {
      console.log("[crash] Auto-restarting in 2 seconds...");
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 2000);
    }
  });

  win.webContents.on("unresponsive", () => {
    console.warn("[crash] Renderer became unresponsive");
    const autoRestart = store.get("settings")?.autoRestart
      ?? store.get(`users.${getUserIdFromStore()}.settings`)?.autoRestart
      ?? true;
    if (autoRestart) {
      console.log("[crash] Auto-restarting due to unresponsive renderer...");
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 5000);
    }
  });

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL || "https://app.studiophotuna.com");
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = true;
  } else {
    win.loadFile(path.join(__dirname, "..", "build", "index.html"));
  }
}

function setupAutoUpdater() {
  const userId = getUserIdFromStore();
  const userSettings = userId ? (store.get(`users.${userId}.settings`) || {}) : {};
  const autoUpdateEnabled = userSettings.autoUpdateEnabled ?? true;

  autoUpdater.autoDownload = false; // renderer drives download via banner click
  autoUpdater.autoInstallOnAppQuit = autoUpdateEnabled;

  autoUpdater.on("checking-for-update", () => {
    mainWindow?.webContents.send("updater:status", {
      status: "checking",
      message: "Checking for updates...",
    });
  });

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("updater:status", {
      status: "available",
      message: "Update available",
      version: info?.version || "",
      info,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    mainWindow?.webContents.send("updater:status", {
      status: "not-available",
      message: "App is up to date",
      version: info?.version || app.getVersion(),
      info,
    });
  });

  autoUpdater.on("error", (error) => {
    mainWindow?.webContents.send("updater:status", {
      status: "error",
      message: error?.message || "Updater error",
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("updater:status", {
      status: "downloading",
      message: "Downloading update...",
      percent: progress?.percent ?? 0,
      bytesPerSecond: progress?.bytesPerSecond ?? 0,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    mainWindow?.webContents.send("updater:status", {
      status: "downloaded",
      message: "Update downloaded. Ready to install.",
      version: info?.version || "",
      info,
    });
  });

  // Silent startup check — fires 15 s after the renderer finishes loading so the
  // app is fully settled before hitting the update server.
  if (mainWindow) {
    mainWindow.webContents.once("did-finish-load", () => {
      let startupTimer = setTimeout(() => {
        autoUpdater.checkForUpdates().catch(() => {});
      }, 15_000);

      // Re-check every 4 hours while the app is open.
      let periodicTimer = setInterval(() => {
        autoUpdater.checkForUpdates().catch(() => {});
      }, 4 * 60 * 60 * 1000);

      mainWindow.once("closed", () => {
        clearTimeout(startupTimer);
        clearInterval(periodicTimer);
      });
    });
  }
}


const PLAN_ENTITLEMENTS = {
  free: {
    max_events: 0,
    templates: 0,
    watermark: true,
    priority_support: false,
  },
  trial: {
    max_events: 3,
    templates: 5,
    watermark: true,
    priority_support: false,
  },
  monthly: {
    max_events: 20,
    templates: 30,
    watermark: false,
    priority_support: false,
  },
  yearly: {
    max_events: 50,
    templates: 100,
    watermark: false,
    priority_support: true,
  },
};

function normalizePlanKey(plan) {
  if (plan === "pro_yearly") return "yearly";
  if (plan === "pro_monthly" || plan === "pro") return "monthly";
  return ["trial", "monthly", "yearly"].includes(plan) ? plan : "free";
}

function mapPlanToLicense(plan, state = "active", existingExpiresAt = undefined) {
  const normalizedPlan = normalizePlanKey(plan);
  const entitlement = PLAN_ENTITLEMENTS[normalizedPlan] || PLAN_ENTITLEMENTS.free;

  // Use the existing DB value when present (admin-set current_period_end wins).
  // Only fall back to a computed value when there is nothing in the DB yet.
  let expiresAt = existingExpiresAt !== undefined ? existingExpiresAt : undefined;
  if (expiresAt === undefined) {
    expiresAt =
      normalizedPlan === "yearly"  ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      : normalizedPlan === "monthly" ? new Date(Date.now() +  30 * 24 * 60 * 60 * 1000).toISOString()
      : normalizedPlan === "trial"   ? new Date(Date.now() +  14 * 24 * 60 * 60 * 1000).toISOString()
      : null;
  }

  return {
    plan: normalizedPlan,
    state: normalizedPlan === "free" ? "active" : state,
    expires_at: expiresAt,
    ...entitlement,
  };
}

// Gallery is a tier (free | plus | business), independent of the Pro plan.
// Accepts a tier string OR a legacy boolean (true -> 'plus', false -> 'free').
function normalizeGalleryTier(value) {
  if (value === true) return "plus";
  if (value === false || value == null) return "free";
  const s = String(value).toLowerCase();
  return ["free", "plus", "business"].includes(s) ? s : "free";
}

function resolveGalleryTier(row = {}) {
  // Prefer the new column; fall back to the legacy boolean.
  if (row.gallery_tier) return normalizeGalleryTier(row.gallery_tier);
  return row.gallery_addon ? "plus" : "free";
}

function mapLicenseEntitlements(row = {}) {
  const galleryTier = resolveGalleryTier(row);
  const galleryEnabled = galleryTier !== "free";
  return {
    watermark: row.watermark ?? true,
    maxEvents: row.max_events ?? 1,
    templates: row.templates ?? 1,
    prioritySupport: row.priority_support ?? false,
    galleryTier,
    galleryAddon: galleryEnabled,
    galleryEnabled,
  };
}

async function upsertLicense(userId, plan, state = "active", extra = {}) {
  // Read the current row so we can preserve current_period_end → expires_at.
  // The admin sets current_period_end once; it must not be overwritten by a
  // computed "now + N days" value from mapPlanToLicense.
  const { data: existing } = await getSupabaseAdmin()
    .from("licenses")
    .select("current_period_end, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  // Priority: explicit extra.expires_at > current_period_end > computed fallback
  const adminExpiry = existing?.current_period_end ?? existing?.expires_at;
  const resolvedExpiry = extra.expires_at !== undefined ? extra.expires_at : adminExpiry;

  const license = mapPlanToLicense(plan, state, resolvedExpiry);

  const { error } = await getSupabaseAdmin().from("licenses").upsert(
    {
      user_id: userId,
      ...license,
      ...extra,
      expires_at: license.expires_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) throw error;

  // The licenses_sync_profile_plan AFTER trigger handles profile sync automatically.
  // We only need a manual write here for the case where the trigger did not fire
  // (e.g. only expires_at changed, not state/plan). Guard against writing 'monthly'
  // when the license is already expired — the trigger writes 'free' and we must not
  // overwrite it.
  const isCurrentlyExpired = resolvedExpiry && new Date(resolvedExpiry).getTime() < Date.now();
  getSupabaseAdmin().from("profiles")
    .update({ subscription_plan: isCurrentlyExpired ? "free" : plan })
    .eq("id", userId)
    .then(() => { }).catch((e) => console.warn("[upsertLicense] profile sync failed:", e.message));

  return license;
}

// Set the gallery entitlement WITHOUT touching the Pro plan/subscription.
// `tierOrEnabled` may be a tier string ('free'|'plus'|'business') or a legacy
// boolean (true -> 'plus', false -> 'free').
async function setGalleryAddonEntitlement(userId, tierOrEnabled, extra = {}) {
  const tier = normalizeGalleryTier(tierOrEnabled);
  const enabled = tier !== "free";

  const { data: existing, error: readError } = await getSupabaseAdmin().from("licenses")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) throw readError;

  const base = existing || {
    user_id: userId,
    plan: "free",
    state: "active",
    expires_at: null,
    ...PLAN_ENTITLEMENTS.free,
    trial_redeemed: false,
  };

  const { error } = await getSupabaseAdmin().from("licenses").upsert(
    {
      user_id: userId,
      plan: base.plan || "free",
      state: base.state || "active",
      expires_at: base.expires_at || null,
      max_events: base.max_events ?? PLAN_ENTITLEMENTS.free.max_events,
      templates: base.templates ?? PLAN_ENTITLEMENTS.free.templates,
      watermark: base.watermark ?? PLAN_ENTITLEMENTS.free.watermark,
      priority_support: base.priority_support ?? PLAN_ENTITLEMENTS.free.priority_support,
      trial_redeemed: Boolean(base.trial_redeemed),
      // Tier is the source of truth; keep the legacy boolean in sync.
      gallery_tier: tier,
      gallery_addon: enabled,
      ...extra,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) throw error;
  return { ok: true, galleryTier: tier, galleryAddon: enabled, galleryEnabled: enabled };
}


// Register auth:syncUser at module level so it is available the instant the renderer mounts,
// avoiding a race where the renderer calls invoke before app.whenReady handlers are set up.
ipcMain.handle("auth:syncUser", async (_e, { userId } = {}) => {
  try {
    if (typeof store.set === "function") {
      store.set("auth.currentUserId", userId || null);
      if (!userId) store.set("auth.lastUsername", null);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("auth:oauth-popup", async (_e, url) => {
  return new Promise((resolve) => {
    const { BrowserWindow } = require("electron");
    const popup = new BrowserWindow({
      width: 500,
      height: 700,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    popup.webContents.on("will-redirect", (_event, redirectUrl) => {
      try {
        const parsed = new URL(redirectUrl);
        const hash = parsed.hash?.slice(1) || "";
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (accessToken) {
          resolve({ access_token: accessToken, refresh_token: refreshToken });
          popup.close();
        }
      } catch {}
    });

    popup.webContents.on("will-navigate", (_event, navUrl) => {
      try {
        const parsed = new URL(navUrl);
        const hash = parsed.hash?.slice(1) || "";
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (accessToken) {
          resolve({ access_token: accessToken, refresh_token: refreshToken });
          popup.close();
        }
      } catch {}
    });

    popup.on("closed", () => {
      resolve({ error: "OAuth popup was closed" });
    });

    popup.loadURL(url);
  });
});

// Read the license row directly via supabaseAdmin (service role, bypasses RLS).
// Called by LicenseContext to avoid HTTP/auth/RLS issues with the anon client.
// Uses select('*') so it never fails on missing optional columns (watermark, max_events, etc.).
ipcMain.handle("license:read", async (_e, userId) => {
  if (!userId) return null;
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('license:read Supabase timed out')), 9000)
    );
    const { data, error } = await Promise.race([
      getSupabaseAdmin().from("licenses").select("*").eq("user_id", userId).maybeSingle(),
      timeout,
    ]);
    if (error) {
      console.warn("[license:read] query error:", error.message);
      return null; // null = network/query failure, not "no row"
    }
    // Return a synthetic free-plan record when the query succeeded but found no row.
    // This lets the renderer distinguish "confirmed free" (no row) from "network error" (null),
    // so the stale paid-plan cache gets cleared instead of being used as the offline fallback.
    return data ?? { plan: 'free', state: 'active', _synthetic: true };
  } catch (e) {
    console.warn("[license:read] failed:", e.message);
    return null; // null = timeout/crash, renderer falls back to cache
  }
});

// Persist the resolved license payload locally so it survives restarts when
// Supabase is unreachable or hasn't been updated yet by webhooks.
const LICENSE_MAX_OFFLINE_MS =
  parseInt(getPrivateConfigValue("LICENSE_MAX_OFFLINE_DAYS") || '7', 10) * 24 * 3600 * 1000;

ipcMain.handle("license:cache-read", async (_e, userId) => {
  try {
    const cached = store?.get('_licenseCache');
    if (!cached || cached.userId !== userId) return null;

    // Use the license's own expires_at as the cache validity boundary.
    // If the license has no expiry (free plan, lifetime, etc.) fall back to the
    // fixed offline window so the cache doesn't live forever.
    const licenseExpiresAt =
      cached.licenseData?.expiresAt || cached.licenseData?.expires_at || null;
    if (licenseExpiresAt) {
      if (new Date(licenseExpiresAt).getTime() < Date.now()) return null; // expired
    } else {
      if (Date.now() - (cached.cachedAt || 0) > LICENSE_MAX_OFFLINE_MS) return null;
    }

    return cached;
  } catch { return null; }
});

ipcMain.handle("license:cache-write", async (_e, userId, payload) => {
  try {
    store?.set('_licenseCache', { ...payload, userId, cachedAt: Date.now() });
    return true;
  } catch { return false; }
});

// Register PayMongo handlers at module level to avoid race with renderer mount.
const _pollManager = new PaymentPollManager();
const _genericPollManager = new GenericPollManager();

// Helper: get active payment gateway from stored settings
function _getActiveGateway() {
  const userId = getUserIdFromStore();
  if (!userId) return null;
  return store.get(`users.${userId}.settings`)?.business?.activeProvider ?? null;
}

async function _getPayMongoService() {
  const sk = await keytar.getPassword(PAYMONGO_SERVICE, "secretKey");
  if (!sk) return null;
  return new PayMongoService(sk);
}

ipcMain.handle("paymongo:saveKeys", async (_e, { publicKey, secretKey } = {}) => {
  try {
    if (!publicKey || !secretKey) return { ok: false, error: "Both keys are required" };
    const svc = new PayMongoService(secretKey);
    await svc.validateKeys();
    await keytar.setPassword(PAYMONGO_SERVICE, "secretKey", secretKey);
    const userId = getUserIdFromStore();
    if (userId) {
      store.set(`users.${userId}.paymongo`, {
        publicKey,
        validated: true,
        testMode: isTestMode(secretKey),
        validatedAt: new Date().toISOString(),
      });
    }
    return { ok: true, testMode: isTestMode(secretKey) };
  } catch (err) {
    return { ok: false, error: err.message || "Invalid PayMongo API keys" };
  }
});

ipcMain.handle("paymongo:getStatus", async () => {
  try {
    const userId = getUserIdFromStore();
    const cfg = userId ? (store.get(`users.${userId}.paymongo`) || {}) : {};
    const sk = await keytar.getPassword(PAYMONGO_SERVICE, "secretKey");
    return {
      ok: true,
      configured: !!sk && !!cfg.validated,
      publicKey: cfg.publicKey ? cfg.publicKey.slice(0, 12) + "..." : null,
      testMode: cfg.testMode ?? false,
      validatedAt: cfg.validatedAt ?? null,
    };
  } catch {
    return { ok: true, configured: false };
  }
});

ipcMain.handle("paymongo:clearKeys", async () => {
  try {
    await keytar.deletePassword(PAYMONGO_SERVICE, "secretKey");
    const userId = getUserIdFromStore();
    if (userId) store.set(`users.${userId}.paymongo`, {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Xendit key persistence (keytar-backed) ──────────────────────────────────
const XENDIT_SERVICE = "StudioPhotunaXendit";

ipcMain.handle("xendit:saveKeys", async (_e, { apiKey } = {}) => {
  try {
    if (!apiKey) return { ok: false, error: "API key is required" };
    if (!apiKey.startsWith("xnd_")) {
      return { ok: false, error: "Invalid Xendit key format. Use the Secret Key from Xendit Dashboard → Settings → API Keys." };
    }
    if (apiKey.toLowerCase().includes("public")) {
      return { ok: false, error: "This is a Public Key. Use the Secret Key instead — it starts with xnd_development_ or xnd_production_." };
    }
    await keytar.setPassword(XENDIT_SERVICE, "apiKey", apiKey);
    const userId = getUserIdFromStore();
    const testMode = apiKey.startsWith("xnd_development");
    if (userId) {
      store.set(`users.${userId}.xendit`, {
        apiKeyPreview: apiKey.slice(0, 16) + "...",
        validated: true,
        testMode,
        validatedAt: new Date().toISOString(),
      });
    }
    return { ok: true, testMode };
  } catch (err) {
    return { ok: false, error: err.message || "Failed to save Xendit key" };
  }
});

ipcMain.handle("xendit:getStatus", async () => {
  try {
    const userId = getUserIdFromStore();
    const cfg = userId ? (store.get(`users.${userId}.xendit`) || {}) : {};
    const ak = await keytar.getPassword(XENDIT_SERVICE, "apiKey");
    return {
      ok: true,
      configured: !!ak && !!cfg.validated,
      apiKeyPreview: cfg.apiKeyPreview ?? null,
      testMode: cfg.testMode ?? false,
    };
  } catch {
    return { ok: true, configured: false };
  }
});

ipcMain.handle("xendit:clearKeys", async () => {
  try {
    await keytar.deletePassword(XENDIT_SERVICE, "apiKey");
    const userId = getUserIdFromStore();
    if (userId) store.set(`users.${userId}.xendit`, {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── PayPal credential persistence (keytar-backed) ───────────────────────────
const PAYPAL_SERVICE = "StudioPhotunaPayPal";

ipcMain.handle("paypal:saveKeys", async (_e, { clientId, clientSecret, sandboxMode } = {}) => {
  try {
    if (!clientId || !clientSecret) return { ok: false, error: "Both Client ID and Secret are required" };
    // Validate credentials by fetching an access token before storing anything.
    const ppBase = sandboxMode ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
    const authRes = await fetch(`${ppBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!authRes.ok) {
      const body = await authRes.json().catch(() => null);
      const hint = sandboxMode
        ? "Make sure you are using Sandbox App credentials from developer.paypal.com."
        : "Make sure you are using Live App credentials and that the Sandbox checkbox is unchecked.";
      return { ok: false, error: `PayPal authentication failed — ${hint}` };
    }
    await keytar.setPassword(PAYPAL_SERVICE, "clientSecret", clientSecret);
    const userId = getUserIdFromStore();
    if (userId) {
      store.set(`users.${userId}.paypal`, {
        clientIdPreview: clientId.slice(0, 14) + "...",
        clientId,
        validated: true,
        sandboxMode: !!sandboxMode,
        validatedAt: new Date().toISOString(),
      });
    }
    return { ok: true, sandboxMode: !!sandboxMode };
  } catch (err) {
    return { ok: false, error: err.message || "Failed to save PayPal credentials" };
  }
});

ipcMain.handle("paypal:getStatus", async () => {
  try {
    const userId = getUserIdFromStore();
    const cfg = userId ? (store.get(`users.${userId}.paypal`) || {}) : {};
    const cs = await keytar.getPassword(PAYPAL_SERVICE, "clientSecret");
    return {
      ok: true,
      configured: !!cs && !!cfg.validated,
      clientIdPreview: cfg.clientIdPreview ?? null,
      sandboxMode: cfg.sandboxMode ?? false,
    };
  } catch {
    return { ok: true, configured: false };
  }
});

ipcMain.handle("paypal:clearKeys", async () => {
  try {
    await keytar.deletePassword(PAYPAL_SERVICE, "clientSecret");
    const userId = getUserIdFromStore();
    if (userId) store.set(`users.${userId}.paypal`, {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("payment:start-qr", async (_e, { amount, currency = "PHP", provider, eventId } = {}) => {
  try {
    const svc = await _getPayMongoService();
    if (!svc) return { ok: false, configured: false, error: "PayMongo not configured" };

    const source = await svc.createSource(provider, amount, currency);
    const qrDataUrl = await generateQrDataUrl(source.checkoutUrl);

    _pollManager.start({
      sourceId: source.id,
      amountPhp: amount,
      currency,
      service: svc,
      onConfirmed: (data) => {
        console.log("[PayMongo] Payment confirmed:", data);
        if (mainWindow) mainWindow.webContents.send("payment:confirmed", { ...data, provider, eventId });
      },
      onFailed: (data) => {
        console.log("[PayMongo] Payment failed:", data);
        if (mainWindow) mainWindow.webContents.send("payment:failed", { ...data, provider, eventId });
      },
    });

    return { ok: true, configured: true, sourceId: source.id, qrDataUrl, checkoutUrl: source.checkoutUrl };
  } catch (err) {
    console.error("[payment:start-qr] error:", err);
    return { ok: false, configured: true, error: err.message };
  }
});

ipcMain.handle("payment:start-card", async (_e, { amount, currency = "PHP", eventId } = {}) => {
  try {
    const activeGateway = _getActiveGateway();

    if (activeGateway === "xendit") {
      const ak = await keytar.getPassword(XENDIT_SERVICE, "apiKey");
      if (!ak) return { ok: false, configured: false, error: "Xendit not configured" };
      const xenditAmount = Number(amount);
      if (!xenditAmount || xenditAmount <= 0) {
        return { ok: false, configured: true, error: "Session price must be greater than zero. Set a price in Controls → Business → Pricing." };
      }
      const svc = new XenditService(ak);
      const invoice = await svc.createInvoice(xenditAmount, currency);
      const qrDataUrl = await generateQrDataUrl(invoice.invoiceUrl);
      _genericPollManager.start({
        sessionId: invoice.id,
        poll: async () => {
          const inv = await svc.getInvoice(invoice.id);
          if (inv.status === "PAID") return { confirmed: true, paymentId: invoice.id };
          if (inv.status === "EXPIRED") return { failed: true, reason: "Invoice expired" };
          return {};
        },
        onConfirmed: (data) => {
          if (mainWindow) mainWindow.webContents.send("payment:confirmed", { ...data, provider: "card", gateway: "xendit", eventId });
        },
        onFailed: (data) => {
          if (mainWindow) mainWindow.webContents.send("payment:failed", { ...data, provider: "card", eventId });
        },
      });
      return { ok: true, configured: true, sessionId: invoice.id, qrDataUrl, checkoutUrl: invoice.invoiceUrl };
    }

    // PayMongo fallback (card via payment intent — operator-confirmed at terminal)
    const svc = await _getPayMongoService();
    if (!svc) return { ok: false, configured: false, error: "No card payment gateway configured" };
    const intent = await svc.createPaymentIntent(amount, currency);
    return { ok: true, configured: true, intentId: intent.id, clientKey: intent.clientKey };
  } catch (err) {
    console.error("[payment:start-card] error:", err);
    return { ok: false, configured: true, error: err.message };
  }
});

ipcMain.handle("payment:start-paypal", async (_e, { amount, currency = "PHP", eventId } = {}) => {
  try {
    const userId = getUserIdFromStore();
    const cfg = userId ? (store.get(`users.${userId}.paypal`) || {}) : {};
    const clientSecret = await keytar.getPassword(PAYPAL_SERVICE, "clientSecret");
    const clientId = cfg.clientId;
    if (!clientId || !clientSecret) return { ok: false, configured: false, error: "PayPal not configured" };
    const paypalAmount = Number(amount);
    if (!paypalAmount || paypalAmount <= 0) {
      return { ok: false, configured: true, error: "Session price must be greater than zero. Set a price in Controls → Business → Pricing." };
    }
    const svc = new PayPalService(clientId, clientSecret, cfg.sandboxMode ?? false);
    const order = await svc.createOrder(paypalAmount, currency);
    if (!order.approvalUrl) return { ok: false, error: "PayPal did not return an approval URL" };
    const qrDataUrl = await generateQrDataUrl(order.approvalUrl);
    _genericPollManager.start({
      sessionId: order.id,
      poll: async () => {
        const o = await svc.getOrder(order.id);
        if (o.status === "COMPLETED") return { confirmed: true, paymentId: order.id };
        if (o.status === "APPROVED") {
          try { await svc.captureOrder(order.id); } catch (_) {}
          return { confirmed: true, paymentId: order.id };
        }
        if (o.status === "VOIDED" || o.status === "CANCELLED") {
          return { failed: true, reason: "Order cancelled" };
        }
        return {};
      },
      onConfirmed: (data) => {
        if (mainWindow) mainWindow.webContents.send("payment:confirmed", { ...data, provider: "paypal", eventId });
      },
      onFailed: (data) => {
        if (mainWindow) mainWindow.webContents.send("payment:failed", { ...data, provider: "paypal", eventId });
      },
    });
    return { ok: true, configured: true, orderId: order.id, qrDataUrl, approvalUrl: order.approvalUrl };
  } catch (err) {
    console.error("[payment:start-paypal] error:", err);
    const isAuthErr = /authentication|unauthorized|401/i.test(err.message || "");
    const msg = isAuthErr
      ? "PayPal authentication failed. Go to Account → Business → PayPal, disconnect, and re-enter your credentials making sure the Sandbox checkbox matches your app type."
      : (err.message || "PayPal payment error");
    return { ok: false, configured: true, error: msg };
  }
});

// Unified gateway payment — see safeHandle("payment:start-gateway") in app.whenReady()
const _startGatewayHandler = async (_e, { amount, currency = "PHP", eventId } = {}) => {
  try {
    const activeGateway = _getActiveGateway();
    if (!activeGateway) return { ok: false, configured: false, error: "No payment gateway selected" };

    if (activeGateway === "paymongo") {
      const svc = await _getPayMongoService();
      if (!svc) return { ok: false, configured: false, error: "PayMongo not configured" };
      const amountPhp = Number(amount);
      if (!amountPhp || amountPhp <= 0) {
        return { ok: false, configured: true, error: "Session price must be greater than zero. Set a price in Controls → Business → Pricing." };
      }
      const link = await svc.createPaymentLink(amountPhp, currency);
      if (!link.checkoutUrl) return { ok: false, configured: true, error: "PayMongo did not return a checkout URL" };
      const qrDataUrl = await generateQrDataUrl(link.checkoutUrl);
      _genericPollManager.start({
        sessionId: link.id,
        poll: async () => {
          const l = await svc.getPaymentLink(link.id);
          if (l.hasPaid) return { confirmed: true, paymentId: l.paymentId ?? link.id };
          if (l.status === "archived") return { failed: true, reason: "Payment link expired" };
          return {};
        },
        onConfirmed: (data) => {
          if (mainWindow) mainWindow.webContents.send("payment:confirmed", { ...data, provider: "paymongo", gateway: "paymongo", eventId });
        },
        onFailed: (data) => {
          if (mainWindow) mainWindow.webContents.send("payment:failed", { ...data, provider: "paymongo", eventId });
        },
      });
      return { ok: true, configured: true, sessionId: link.id, qrDataUrl, checkoutUrl: link.checkoutUrl };
    }

    if (activeGateway === "xendit") {
      const ak = await keytar.getPassword(XENDIT_SERVICE, "apiKey");
      if (!ak) return { ok: false, configured: false, error: "Xendit not configured" };
      const xenditAmount = Number(amount);
      if (!xenditAmount || xenditAmount <= 0) {
        return { ok: false, configured: true, error: "Session price must be greater than zero. Set a price in Controls → Business → Pricing." };
      }
      const svc = new XenditService(ak);
      const invoice = await svc.createInvoice(xenditAmount, currency);
      const qrDataUrl = await generateQrDataUrl(invoice.invoiceUrl);
      _genericPollManager.start({
        sessionId: invoice.id,
        poll: async () => {
          const inv = await svc.getInvoice(invoice.id);
          if (inv.status === "PAID") return { confirmed: true, paymentId: invoice.id };
          if (inv.status === "EXPIRED") return { failed: true, reason: "Invoice expired" };
          return {};
        },
        onConfirmed: (data) => {
          if (mainWindow) mainWindow.webContents.send("payment:confirmed", { ...data, provider: "xendit", gateway: "xendit", eventId });
        },
        onFailed: (data) => {
          if (mainWindow) mainWindow.webContents.send("payment:failed", { ...data, provider: "xendit", eventId });
        },
      });
      return { ok: true, configured: true, sessionId: invoice.id, qrDataUrl, checkoutUrl: invoice.invoiceUrl };
    }

    if (activeGateway === "paypal") {
      const userId = getUserIdFromStore();
      const cfg = userId ? (store.get(`users.${userId}.paypal`) || {}) : {};
      const clientSecret = await keytar.getPassword(PAYPAL_SERVICE, "clientSecret");
      const clientId = cfg.clientId;
      if (!clientId || !clientSecret) return { ok: false, configured: false, error: "PayPal not configured" };
      const paypalAmount = Number(amount);
      if (!paypalAmount || paypalAmount <= 0) {
        return { ok: false, configured: true, error: "Session price must be greater than zero. Set a price in Controls → Business → Pricing." };
      }
      const svc = new PayPalService(clientId, clientSecret, cfg.sandboxMode ?? false);
      const order = await svc.createOrder(paypalAmount, currency);
      if (!order.approvalUrl) return { ok: false, configured: true, error: "PayPal did not return an approval URL" };
      const qrDataUrl = await generateQrDataUrl(order.approvalUrl);
      _genericPollManager.start({
        sessionId: order.id,
        poll: async () => {
          const o = await svc.getOrder(order.id);
          if (o.status === "COMPLETED") return { confirmed: true, paymentId: order.id };
          if (o.status === "APPROVED") {
            try { await svc.captureOrder(order.id); } catch (_) {}
            return { confirmed: true, paymentId: order.id };
          }
          if (o.status === "VOIDED" || o.status === "CANCELLED") return { failed: true, reason: "Order cancelled" };
          return {};
        },
        onConfirmed: (data) => {
          if (mainWindow) mainWindow.webContents.send("payment:confirmed", { ...data, provider: "paypal", gateway: "paypal", eventId });
        },
        onFailed: (data) => {
          if (mainWindow) mainWindow.webContents.send("payment:failed", { ...data, provider: "paypal", eventId });
        },
      });
      return { ok: true, configured: true, sessionId: order.id, qrDataUrl, approvalUrl: order.approvalUrl };
    }

    return { ok: false, configured: false, error: `Unknown gateway: ${activeGateway}` };
  } catch (err) {
    console.error("[payment:start-gateway] error:", err);
    return { ok: false, configured: true, error: err.message };
  }
};

ipcMain.handle("paymongo:cancelPayment", async (_e, { sourceId, sessionId } = {}) => {
  if (sourceId) _pollManager.cancel(sourceId);
  if (sessionId) _genericPollManager.cancel(sessionId);
  return { ok: true };
});

// ── Cash hardware detection ────────────────────────────────────────────────
// Known bill validator & coin acceptor device-name substrings (case-insensitive).
const CASH_HW_PATTERNS = [
  "ICT BV", "JCM", "MEI", "CPI BV", "NV200", "NV9USB", "Cashcode", "Pyramid",
  "Global Bill", "Crane", "Mars", "bill acceptor", "bill validator",
  "coin acceptor", "coin mech", "NRI", "CoinCo", "Azkoyen",
];

ipcMain.handle("cash:detectHardware", async () => {
  try {
    const { execSync } = require("child_process");
    // Query WMI for serial port descriptions on Windows
    const raw = execSync(
      `powershell -NoProfile -NonInteractive -Command "Get-WmiObject Win32_SerialPort | Select-Object -ExpandProperty Description"`,
      { timeout: 6000, encoding: "utf8", windowsHide: true }
    ).trim();

    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const lowerPatterns = CASH_HW_PATTERNS.map((p) => p.toLowerCase());
    const found = lines.filter((l) =>
      lowerPatterns.some((p) => l.toLowerCase().includes(p))
    );
    return { ok: true, detected: found.length > 0, devices: found };
  } catch (err) {
    // WMI unavailable or timed out — treat as not detected, not an error
    return { ok: true, detected: false, devices: [], error: err.message };
  }
});

// ── Card terminal detection ─────────────────────────────────────────────────
// Known card reader / POS terminal device-name substrings (case-insensitive).
// Covers Ingenico, Verifone, PAX, ID TECH, MagTek, Stripe Terminal readers.
const CARD_TERMINAL_PATTERNS = [
  "ingenico", "ict2", "ict3", "ipp3", "iwl", "desk/",
  "verifone", "vx520", "vx680", "v400", "p400", "mx925",
  "pax ", "a920", "a80 ", "a60 ", "s300", "sp20",
  "id tech", "idtech", "augusta", "minismart",
  "magtek", "udynamo", "edynamo", "bdynamo",
  "bbpos", "wisepos", "chipper", "rp457", "rp750",
  "usb card reader", "usb swipe", "msr ", "emv reader",
  "card reader", "payment terminal", "pinpad",
];

ipcMain.handle("card:detectTerminal", async () => {
  try {
    const { execSync } = require("child_process");
    // Query all PnP devices (USB + serial) for card terminal signatures
    const raw = execSync(
      `powershell -NoProfile -NonInteractive -Command "Get-WmiObject Win32_PnPEntity | Select-Object -ExpandProperty Name"`,
      { timeout: 7000, encoding: "utf8", windowsHide: true }
    ).trim();
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const found = lines.filter((l) =>
      CARD_TERMINAL_PATTERNS.some((p) => l.toLowerCase().includes(p))
    );
    return { ok: true, detected: found.length > 0, devices: found };
  } catch (err) {
    return { ok: true, detected: false, devices: [], error: err.message };
  }
});

// Stub — wire to actual serial protocol (EBDS/ccnet) when hardware is on hand
ipcMain.handle("cash:startHardwarePayment", async (_e, { amount } = {}) => {
  console.log(`[CashHW] Start hardware payment session — amount PHP ${amount}`);
  return { ok: true, started: false, reason: "hardware_protocol_not_implemented" };
});

ipcMain.handle("cash:stopHardwarePayment", async () => {
  console.log("[CashHW] Stop hardware payment session");
  return { ok: true };
});

// ── Stripe payment gateway (booth card payments — keys stored locally in keytar) ─
const STRIPE_SERVICE = "StudioPhotunaStripe";

ipcMain.handle("stripe:saveKeys", async (_e, { publishableKey, secretKey } = {}) => {
  try {
    if (!publishableKey || !secretKey) return { ok: false, error: "Both keys are required" };
    if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("sk_live_")) {
      return { ok: false, error: "Invalid Stripe secret key format" };
    }
    await keytar.setPassword(STRIPE_SERVICE, "secretKey", secretKey);
    const userId = getUserIdFromStore();
    const testMode = secretKey.startsWith("sk_test_");
    if (userId) {
      store.set(`users.${userId}.stripe`, {
        publishableKeyPreview: publishableKey.slice(0, 14) + "...",
        validated: true,
        testMode,
        validatedAt: new Date().toISOString(),
      });
    }
    return { ok: true, testMode };
  } catch (err) {
    return { ok: false, error: err.message || "Failed to save Stripe keys" };
  }
});

ipcMain.handle("stripe:getStatus", async () => {
  try {
    const userId = getUserIdFromStore();
    const cfg = userId ? (store.get(`users.${userId}.stripe`) || {}) : {};
    const sk = await keytar.getPassword(STRIPE_SERVICE, "secretKey");
    return {
      ok: true,
      configured: !!sk && !!cfg.validated,
      publishableKeyPreview: cfg.publishableKeyPreview ?? null,
      testMode: cfg.testMode ?? false,
      validatedAt: cfg.validatedAt ?? null,
    };
  } catch {
    return { ok: true, configured: false };
  }
});

ipcMain.handle("stripe:clearKeys", async () => {
  try {
    await keytar.deletePassword(STRIPE_SERVICE, "secretKey");
    const userId = getUserIdFromStore();
    if (userId) store.set(`users.${userId}.stripe`, {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── System health ────────────────────────────────────────────────────────────
// _healthMonitor is initialized in app.whenReady; snapshot may be null on first call.
ipcMain.handle("health:status", () => {
  // HealthMonitor instance is created inside whenReady; expose via module-level ref.
  return global._healthMonitor ? global._healthMonitor.getSnapshot() : null;
});

// ── Gallery admin ─────────────────────────────────────────────────────────────
ipcMain.handle("gallery:openAdmin", async (_e, { eventId } = {}) => {
  const { shell } = require("electron");
  const base = "https://gallery.studiophotuna.com/admin";
  let url = base;
  if (eventId) {
    try {
      const admin = createSupabaseAdmin();
      const { data } = await admin
        .from("galleries")
        .select("slug")
        .eq("event_id", eventId)
        .is("session_id", null)
        .maybeSingle();
      url = data?.slug ? `${base}/gallery/${data.slug}` : `${base}/event/${eventId}`;
    } catch {
      url = `${base}/event/${eventId}`;
    }
  }
  await shell.openExternal(url);
  return { ok: true };
});

// ── Cloud storage ─────────────────────────────────────────────────────────────

const CLOUD_KEYTAR_SERVICE = 'StudioPhotunaCloud';
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, DROPBOX_APP_KEY } = require('./cloud-config');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const httpMod = require('http');
    const srv = httpMod.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

function waitForOAuthCode(port) {
  return new Promise((resolve, reject) => {
    const httpMod = require('http');
    let settled = false;
    const srv = httpMod.createServer((req, res) => {
      try {
        const u = new URL(req.url, `http://127.0.0.1:${port}`);
        const code = u.searchParams.get('code');
        const error = u.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="font-family:sans-serif;text-align:center;padding:48px"><h2>Authentication complete</h2><p>You may close this tab.</p><script>window.close()</script></body></html>');
        if (settled) return;
        settled = true;
        srv.close();
        if (error) reject(new Error(error));
        else if (code) resolve(code);
        else reject(new Error('No code returned from OAuth provider'));
      } catch (e) { if (!settled) { settled = true; srv.close(); reject(e); } }
    });
    srv.listen(port, '127.0.0.1');
    srv.on('error', reject);
    const t = setTimeout(() => { if (!settled) { settled = true; srv.close(); reject(new Error('OAuth flow timed out (5 min)')); } }, 300_000);
    srv.on('close', () => clearTimeout(t));
  });
}

async function refreshGoogleToken(tokens) {
  if (tokens.access_token && tokens.token_expiry && Date.now() < tokens.token_expiry - 60_000) return tokens;
  if (!tokens.refresh_token) throw new Error('Google Drive token expired — please reconnect');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  const data = await res.json();
  return { ...tokens, access_token: data.access_token, token_expiry: Date.now() + (data.expires_in || 3600) * 1000 };
}

// Google Drive
ipcMain.handle('cloud:google-drive:status', async () => {
  try {
    const raw = await keytar.getPassword(CLOUD_KEYTAR_SERVICE, 'google');
    if (!raw) return { connected: false, email: null };
    const { email } = JSON.parse(raw);
    return { connected: true, email: email || null };
  } catch { return { connected: false, email: null }; }
});

ipcMain.handle('cloud:google-drive:connect', async () => {
  try {
    const port = await findFreePort();
    const redirectUri = `http://127.0.0.1:${port}`;
    const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    const { shell } = require('electron');
    const codePromise = waitForOAuthCode(port);
    await shell.openExternal(authUrl.toString());
    const code = await codePromise;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
    const tokenData = await tokenRes.json();

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();

    const stored = { access_token: tokenData.access_token, refresh_token: tokenData.refresh_token, token_expiry: Date.now() + (tokenData.expires_in || 3600) * 1000, email: profile.email };
    await keytar.setPassword(CLOUD_KEYTAR_SERVICE, 'google', JSON.stringify(stored));
    return { ok: true, email: profile.email };
  } catch (err) {
    console.error('[cloud:google-drive:connect]', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('cloud:google-drive:disconnect', async () => {
  try { await keytar.deletePassword(CLOUD_KEYTAR_SERVICE, 'google'); } catch {}
  return { ok: true };
});

// Fixed loopback port for Dropbox (must be registered in Dropbox App Console)
const DROPBOX_REDIRECT_PORT = 49152;

// Dropbox (PKCE — no client secret required for desktop apps)
ipcMain.handle('cloud:dropbox:status', async () => {
  try {
    const raw = await keytar.getPassword(CLOUD_KEYTAR_SERVICE, 'dropbox');
    if (!raw) return { connected: false, email: null };
    const { email } = JSON.parse(raw);
    return { connected: true, email: email || null };
  } catch { return { connected: false, email: null }; }
});

ipcMain.handle('cloud:dropbox:connect', async () => {
  try {
    const port = DROPBOX_REDIRECT_PORT;
    const redirectUri = `http://localhost:${port}`;
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    const authUrl = new URL('https://www.dropbox.com/oauth2/authorize');
    authUrl.searchParams.set('client_id', DROPBOX_APP_KEY);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('token_access_type', 'offline');

    const { shell } = require('electron');
    const codePromise = waitForOAuthCode(port);
    await shell.openExternal(authUrl.toString());
    const code = await codePromise;

    const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: DROPBOX_APP_KEY, redirect_uri: redirectUri, code_verifier: verifier }),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
    const tokenData = await tokenRes.json();

    const accountRes = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
      body: 'null',
    });
    const account = await accountRes.json();

    const stored = { access_token: tokenData.access_token, refresh_token: tokenData.refresh_token || null, email: account?.email || account?.name?.display_name || null };
    await keytar.setPassword(CLOUD_KEYTAR_SERVICE, 'dropbox', JSON.stringify(stored));
    return { ok: true, email: stored.email };
  } catch (err) {
    console.error('[cloud:dropbox:connect]', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('cloud:dropbox:disconnect', async () => {
  try { await keytar.deletePassword(CLOUD_KEYTAR_SERVICE, 'dropbox'); } catch {}
  return { ok: true };
});

// Cloud upload — uploads composed photo to Google Drive or Dropbox after each session
ipcMain.handle('cloud:upload', async (_e, { provider, composedImagePath, composedImageDataUrl, filename, eventName, sessionId } = {}) => {
  try {
    if (!provider) throw new Error('No cloud provider specified');

    let imageBuffer;
    if (composedImagePath && fs.existsSync(composedImagePath)) {
      imageBuffer = fs.readFileSync(composedImagePath);
    } else if (composedImageDataUrl) {
      imageBuffer = Buffer.from(composedImageDataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    } else {
      throw new Error('No image data provided');
    }

    const safeFilename = filename || `session-${sessionId || Date.now()}.png`;

    if (provider === 'google-drive') {
      const raw = await keytar.getPassword(CLOUD_KEYTAR_SERVICE, 'google');
      if (!raw) throw new Error('Google Drive not connected');
      let tokens = JSON.parse(raw);
      tokens = await refreshGoogleToken(tokens);
      await keytar.setPassword(CLOUD_KEYTAR_SERVICE, 'google', JSON.stringify(tokens));
      const { access_token } = tokens;

      // Find or create "Photuna Photos" root folder
      const rootSearch = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("name='Photuna Photos' and mimeType='application/vnd.google-apps.folder' and trashed=false")}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      const rootData = await rootSearch.json();
      let parentId = rootData.files?.[0]?.id;
      if (!parentId) {
        const mkRoot = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Photuna Photos', mimeType: 'application/vnd.google-apps.folder' }),
        });
        parentId = (await mkRoot.json()).id;
      }

      // Find or create event sub-folder
      let uploadParentId = parentId;
      if (eventName) {
        const evSearch = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name='${eventName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id)`,
          { headers: { Authorization: `Bearer ${access_token}` } }
        );
        const evData = await evSearch.json();
        if (evData.files?.[0]?.id) {
          uploadParentId = evData.files[0].id;
        } else {
          const mkEv = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: eventName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
          });
          uploadParentId = (await mkEv.json()).id;
        }
      }

      // Multipart upload
      const boundary = `photuna_${crypto.randomBytes(8).toString('hex')}`;
      const metaJson = JSON.stringify({ name: safeFilename, parents: [uploadParentId] });
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: image/png\r\n\r\n`),
        imageBuffer,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const upRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      if (!upRes.ok) throw new Error(`Google Drive upload failed: ${await upRes.text()}`);
      return { ok: true, provider: 'google-drive' };
    }

    if (provider === 'dropbox') {
      const raw = await keytar.getPassword(CLOUD_KEYTAR_SERVICE, 'dropbox');
      if (!raw) throw new Error('Dropbox not connected');
      const { access_token } = JSON.parse(raw);
      const dropboxPath = `/Photuna Photos${eventName ? `/${eventName}` : ''}/${safeFilename}`;
      const upRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'add', autorename: true, mute: false }),
        },
        body: imageBuffer,
      });
      if (!upRes.ok) throw new Error(`Dropbox upload failed: ${await upRes.text()}`);
      return { ok: true, provider: 'dropbox' };
    }

    throw new Error(`Unknown provider: ${provider}`);
  } catch (err) {
    console.error('[cloud:upload]', err);
    return { ok: false, error: err.message };
  }
});

/* -------------------------------------------------------
 * 🚀 App Lifecycle
 * -----------------------------------------------------*/
app.whenReady().then(async () => {

  // Clean up orphaned print temp files older than 24 hours (GDPR storage limitation)
  try {
    const printTempDir = path.join(app.getPath("temp"), "photuna-prints");
    if (fs.existsSync(printTempDir)) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      fs.readdirSync(printTempDir).forEach((f) => {
        try {
          const fp = path.join(printTempDir, f);
          if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
        } catch {}
      });
    }
  } catch {}

  const uid = getUserIdFromStore();
  if (uid) {
    const { eventsFile: userEvents } = getPaths(uid);
    const { eventsFile: anonEvents } = getPaths(null); // will resolve to 'anon'
    try {
      const anon = fs.existsSync(anonEvents) ? JSON.parse(fs.readFileSync(anonEvents, 'utf8')) : [];
      const mine = fs.existsSync(userEvents) ? JSON.parse(fs.readFileSync(userEvents, 'utf8')) : [];
      if (Array.isArray(anon) && anon.length && Array.isArray(mine) && mine.length === 0) {
        fs.writeFileSync(userEvents, JSON.stringify(anon, null, 2), 'utf8');
        // Optionally archive anon
        // fs.renameSync(anonEvents, anonEvents + '.migrated');
      }
    } catch (e) { console.warn('migration check failed', e); }
  }

  // Custom protocol: app://assets/<userId>/assets/<eventId>/<filename>
  protocol.registerFileProtocol("app", (request, callback) => {
    try {
      const urlStr = request.url; // e.g. app://assets/event123/background-17123.gif
      const prefix = "app://assets/";
      if (!urlStr.startsWith(prefix)) return callback({ path: "" });
      const rel = sanitizeRelKey(urlStr.slice(prefix.length)); // eventId/filename
      const fullPath = path.normalize(path.join(USERS_DIR, rel));
      if (!fullPath.startsWith(USERS_DIR)) return callback({ path: "" });
      callback({ path: fullPath });
    } catch (err) {
      console.error("protocol app://assets error", err);
      callback({ path: "" });
    }
  });

  createWindow();
  setupAutoUpdater();
  scheduleAutoCleanup();

  const _logDir = path.join(app.getPath("userData"), "logs");
  global._healthMonitor = new HealthMonitor({ userDataDir: app.getPath("userData"), usersDir: USERS_DIR, logDir: _logDir });
  global._healthMonitor.start();

  const { shell } = require('electron');

  function toHex(buf) { return Buffer.isBuffer(buf) ? buf.toString('hex') : String(buf || ''); }

  async function getOrCreateDataKey() {
    let k = await keytar.getPassword(LICENSE_KEY_SERVICE, LICENSE_KEY_ACCOUNT);
    if (!k) {
      const newKey = crypto.randomBytes(32).toString('hex'); // 256-bit
      await keytar.setPassword(LICENSE_KEY_SERVICE, LICENSE_KEY_ACCOUNT, newKey);
      k = newKey;
    }
    return Buffer.from(k, 'hex');
  }

  function encryptBlob(plaintextBuf, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  function decryptBlob(b64, key) {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const enc = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec;
  }

  function getAccountPreferencesKey(userId) {
    return `users.${String(userId || getUserIdFromStore())}.account.preferences`;
  }

  function safeHandle(channel, handler) {
    try {
      try { ipcMain.removeHandler(channel); } catch { }
      ipcMain.handle(channel, handler);
    } catch (err) {
      console.error(`Failed to register handler ${channel}:`, err);
    }
  }

  safeHandle("log:clear", async () => {
    try {
      const exportDir = path.join(USERDATA, "logs");
      if (!fs.existsSync(exportDir)) return { ok: true, message: "No logs to clear" };
      const files = fs.readdirSync(exportDir).filter(f => f.endsWith(".txt"));
      for (const f of files) {
        try { fs.unlinkSync(path.join(exportDir, f)); } catch { }
      }
      return { ok: true, message: `Cleared ${files.length} log file(s)` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  safeHandle("payment:start-gateway", _startGatewayHandler);

  safeHandle("payment:finalize-cash", async (_e, { amount, currency }) => {
    console.log(`[Cash] Finalizing PHP ${amount} ${currency}`);
    return { ok: true, method: "cash", amount, currency };
  });

  safeHandle("payment:charge-additional", async (_e, { amount, method }) => {
    return { ok: false, configured: false, amount, method };
  });

  safeHandle("payment:record", async (_e, record) => {
    const userId = getUserIdFromStore();
    const { metaFile } = resolveBoothOutputDirs({
      userId,
      eventId: record?.eventId || "default",
      sessionId: "current",
      storagePath: "",
    });
    const meta = readJson(metaFile, {});
    meta.payments = Array.isArray(meta.payments) ? meta.payments : [];
    meta.payments.push({ ...record, recordedAt: new Date().toISOString() });
    writeJson(metaFile, meta);
    return { ok: true };
  });

  safeHandle("account:getPreferences", async (_e, { userId } = {}) => {
    try {
      const key = getAccountPreferencesKey(userId);
      const preferences =
        typeof store.get === "function" ? (store.get(key) || {}) : {};

      return {
        ok: true,
        preferences: {
          theme: preferences.theme || "system",
          language: preferences.language || "en",
          emailNotifications: Boolean(preferences.emailNotifications),
          desktopNotifications:
            preferences.desktopNotifications !== false,
          autoLaunch: Boolean(preferences.autoLaunch),
          soundEnabled: preferences.soundEnabled !== false,
          updatedAt: preferences.updatedAt || null,
        },
      };
    } catch (err) {
      console.error("account:getPreferences error", err);
      return { ok: false, error: String(err), preferences: null };
    }
  });

  safeHandle("account:savePreferences", async (_e, payload = {}) => {
    try {
      const userId = payload?.userId || getUserIdFromStore();
      const key = getAccountPreferencesKey(userId);
      const existing =
        typeof store.get === "function" ? (store.get(key) || {}) : {};

      const nextPreferences = {
        ...existing,
        theme: payload.theme || existing.theme || "system",
        language: payload.language || existing.language || "en",
        emailNotifications: Boolean(payload.emailNotifications),
        desktopNotifications: payload.desktopNotifications !== false,
        autoLaunch: Boolean(payload.autoLaunch),
        soundEnabled: payload.soundEnabled !== false,
        updatedAt: new Date().toISOString(),
      };

      if (typeof store.set === "function") {
        store.set(key, nextPreferences);
      }

      return { ok: true, preferences: nextPreferences };
    } catch (err) {
      console.error("account:savePreferences error", err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle("account:changePassword", async (_e, payload = {}) => {
    try {
      const currentPassword = String(payload.currentPassword || "");
      const newPassword = String(payload.newPassword || "");
      const confirmPassword = String(payload.confirmPassword || "");

      const username =
        String(payload.username || "").trim() ||
        (typeof store.get === "function" ? store.get(AUTH_LAST_USERNAME_KEY) : "") ||
        "";

      if (!username) {
        return { ok: false, error: "No signed-in account found." };
      }

      if (!currentPassword || !newPassword || !confirmPassword) {
        return { ok: false, error: "All password fields are required." };
      }

      if (newPassword !== confirmPassword) {
        return { ok: false, error: "New password and confirmation do not match." };
      }

      if (newPassword.length < 6) {
        return { ok: false, error: "New password must be at least 6 characters." };
      }

      const savedSecret = await keytar.getPassword(AUTH_SERVICE_NAME, username);
      if (!savedSecret) {
        return { ok: false, error: "Stored credentials not found." };
      }

      if (savedSecret !== currentPassword) {
        return { ok: false, error: "Current password is incorrect." };
      }

      await keytar.setPassword(AUTH_SERVICE_NAME, username, newPassword);

      return { ok: true };
    } catch (err) {
      console.error("account:changePassword error", err);
      return { ok: false, error: String(err) };
    }
  });

  // --- Session (tokens) ---
  safeHandle('auth:saveSession', async (_e, { accessToken, refreshToken }) => {
    try {
      if (accessToken) await keytar.setPassword(SESSION_SERVICE, `${SESSION_ACCOUNT}:access`, accessToken);
      if (refreshToken) await keytar.setPassword(SESSION_SERVICE, `${SESSION_ACCOUNT}:refresh`, refreshToken);
      return { ok: true };
    } catch (err) {
      console.error('auth:saveSession error', err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle('auth:getSession', async () => {
    try {
      const accessToken = await keytar.getPassword(SESSION_SERVICE, `${SESSION_ACCOUNT}:access`);
      const refreshToken = await keytar.getPassword(SESSION_SERVICE, `${SESSION_ACCOUNT}:refresh`);
      return { ok: true, accessToken: accessToken || null, refreshToken: refreshToken || null };
    } catch (err) {
      console.error('auth:getSession error', err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle('auth:clearSession', async () => {
    try {
      await keytar.deletePassword(SESSION_SERVICE, `${SESSION_ACCOUNT}:access`);
      await keytar.deletePassword(SESSION_SERVICE, `${SESSION_ACCOUNT}:refresh`);
      return { ok: true };
    } catch (err) {
      console.error('auth:clearSession error', err);
      return { ok: false, error: String(err) };
    }
  });

  // --- License cache (encrypted) ---
  safeHandle('license:cacheSave', async (_e, { signedLicense }) => {
    try {
      if (!signedLicense) return { ok: false, error: 'missing_license' };
      const key = await getOrCreateDataKey();
      const cipherText = encryptBlob(Buffer.from(signedLicense, 'utf8'), key);
      // persist cipher text in your electron-store
      if (typeof store.set === 'function') store.set('license.cache', cipherText);
      else if (typeof store.setSettings === 'function') {
        const s = (typeof store.getSettings === 'function' ? store.getSettings() : store.get('settings')) || {};
        s.licenseCache = cipherText;
        typeof store.setSettings === 'function' ? store.setSettings(s) : store.set('settings', s);
      }
      return { ok: true };
    } catch (err) {
      console.error('license:cacheSave error', err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle('license:cacheLoad', async () => {
    try {
      const cipherText =
        (typeof store.get === 'function' ? store.get('license.cache') : null) ||
        (typeof store.getSettings === 'function' ? (store.getSettings() || {}).licenseCache : null);
      if (!cipherText) return { ok: false, signedLicense: null };
      const key = await getOrCreateDataKey();
      const plain = decryptBlob(cipherText, key).toString('utf8');
      return { ok: true, signedLicense: plain };
    } catch (err) {
      console.error('license:cacheLoad error', err);
      return { ok: false, error: String(err), signedLicense: null };
    }
  });

  safeHandle('license:cacheClear', async () => {
    try {
      if (typeof store.set === 'function') store.set('license.cache', null);
      if (typeof store.getSettings === 'function') {
        const s = store.getSettings() || {};
        delete s.licenseCache;
        typeof store.setSettings === 'function' ? store.setSettings(s) : store.set('settings', s);
      }
      return { ok: true };
    } catch (err) {
      console.error('license:cacheClear error', err);
      return { ok: false, error: String(err) };
    }
  });

  // --- Convenience: system fingerprint & open external ---
  safeHandle('system:getFingerprint', async () => {
    try {
      const payload = `${os.type()}|${os.arch()}|${os.hostname()}|${os.platform()}|${os.release()}|${os.userInfo().username}`;
      const hash = crypto.createHash('sha256').update(payload).digest('hex');
      return { ok: true, fingerprint: hash };
    } catch (err) {
      console.error('system:getFingerprint error', err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle('system:openExternal', async (_e, url) => {
    try {
      const parsed = new URL(String(url));
      if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
        return { ok: false, error: `Blocked protocol: ${parsed.protocol}` };
      }
      await shell.openExternal(parsed.href);
      return { ok: true };
    } catch (err) {
      console.error('system:openExternal error', err);
      return { ok: false, error: String(err) };
    }
  });


  // === Secure Auth IPC Handlers ===
  safeHandle("secureStore:getIdentity", async () => {
    try {
      const lastUsername = (typeof store.get === "function" ? store.get(AUTH_LAST_USERNAME_KEY) : null) || null;
      const map = (typeof store.get === "function" ? store.get('auth.userIdByUsername') : {}) || {};
      const userId = (typeof store.get === "function" ? store.get('auth.currentUserId') : null) || null;
      return { username: lastUsername, userId: userId || map[lastUsername] || null };
    } catch (err) { return { username: null, userId: null, error: String(err) }; }
  });

  // Clear identity (username + current userId)
  safeHandle("secureStore:clearIdentity", async () => {
    try {
      if (typeof store.set === "function") {
        store.set("auth.currentUserId", null);
        store.set("auth.lastUsername", null);
      }
      return { ok: true };
    } catch (err) {
      console.error("secureStore:clearIdentity error", err);
      return { ok: false, error: String(err) };
    }
  });

  // Core store handlers
  safeHandle("store:getEvents", (_e, { userId } = {}) => {
    const { eventsFile } = getPaths(userId);
    try { return JSON.parse(fs.readFileSync(eventsFile, "utf8")); } catch { return []; }
  });

  safeHandle("store:setEvents", (_e, events, { userId } = {}) => {
    const { eventsFile } = getPaths(userId);
    try { fs.writeFileSync(eventsFile, JSON.stringify(Array.isArray(events) ? events : [], null, 2)); return true; }
    catch (err) { console.error("store:setEvents error", err); return false; }
  });

  safeHandle("store:getCurrentEventId", () => {
    try {
      return typeof store.getCurrentEventId === "function" ? store.getCurrentEventId() : store.get("currentEventId");
    } catch (err) {
      console.error("store:getCurrentEventId error", err);
      return null;
    }
  });
  safeHandle("store:setCurrentEventId", (_e, id) => {
    try {
      return typeof store.setCurrentEventId === "function" ? store.setCurrentEventId(id) : store.set("currentEventId", id);
    } catch (err) {
      console.error("store:setCurrentEventId error", err);
      return null;
    }
  });

  safeHandle("store:getCurrentSubTab", () => {
    try {
      return typeof store.getCurrentSubTab === "function" ? store.getCurrentSubTab() : store.get("currentSubTab");
    } catch (err) {
      console.error("store:getCurrentSubTab error", err);
      return "appearance";
    }
  });
  safeHandle("store:setCurrentSubTab", (_e, tab) => {
    try {
      return typeof store.setCurrentSubTab === "function" ? store.setCurrentSubTab(tab) : store.set("currentSubTab", tab);
    } catch (err) {
      console.error("store:setCurrentSubTab error", err);
      return null;
    }
  });

  safeHandle("store:getAppearance", (_e, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.appearance`;
      return (typeof store.get === "function" ? (store.get(key) || {}) : {});
    } catch (err) { console.error("store:getAppearance error", err); return {}; }
  });

  safeHandle("store:setAppearance", (_e, appearance, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.appearance`;
      return (typeof store.set === "function" ? store.set(key, appearance) : null);
    } catch (err) { console.error("store:setAppearance error", err); return null; }
  });

  safeHandle("store:getSettings", (_e, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.settings`;
      return (typeof store.get === "function" ? (store.get(key) || {}) : {});
    } catch (err) { console.error("store:getSettings error", err); return {}; }
  });

  safeHandle("store:setSettings", (_e, appearance, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.settings`;
      return (typeof store.set === "function" ? store.set(key, appearance) : null);
    } catch (err) { console.error("store:setSettings error", err); return null; }
  });

  safeHandle("store:getTemplates", (_e, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.templates`;
      const v = typeof store.get === "function" ? store.get(key) : [];
      return Array.isArray(v) ? v : [];
    } catch (err) { console.error("store:getTemplates error", err); return []; }
  });

  safeHandle("store:setTemplates", (_e, appearance, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.templates`;
      return (typeof store.set === "function" ? store.set(key, appearance) : null);
    } catch (err) { console.error("store:setTemplates error", err); return null; }
  });

  safeHandle("store:getPalettes", (_e, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.palettes`;
      const v = typeof store.get === "function" ? store.get(key) : [];
      return Array.isArray(v) ? v : [];
    } catch (err) { console.error("store:getPalettes error", err); return []; }
  });

  safeHandle("store:setPalettes", (_e, appearance, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.palettes`;
      return (typeof store.set === "function" ? store.set(key, appearance) : null);
    } catch (err) { console.error("store:setPalettes error", err); return null; }
  });
  safeHandle("store:getFrames", (_e, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.frames`;
      const v = typeof store.get === "function" ? store.get(key) : [];
      return Array.isArray(v) ? v : [];
    } catch (err) { console.error("store:getFrames error", err); return []; }
  });

  safeHandle("store:setFrames", (_e, appearance, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.frames`;
      return (typeof store.set === "function" ? store.set(key, appearance) : null);
    } catch (err) { console.error("store:setFrames error", err); return null; }
  });
  safeHandle("store:getTones", (_e, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.tones`;
      const v = typeof store.get === "function" ? store.get(key) : [];
      return Array.isArray(v) ? v : [];
    } catch (err) { console.error("store:getTones error", err); return []; }
  });

  safeHandle("store:setTones", (_e, appearance, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.tones`;
      return (typeof store.set === "function" ? store.set(key, appearance) : null);
    } catch (err) { console.error("store:setTones error", err); return null; }
  });

  // ====== Active main-tab persistence ======
  safeHandle("store:getActiveMain", () => {
    try {
      return (typeof store.get === "function" ? (store.get("activeMain") || "home") : "home");
    } catch (err) {
      console.error("store:getActiveMain error", err);
      return "home";
    }
  });

  safeHandle("store:setActiveMain", (_e, tab) => {
    try {
      return (typeof store.set === "function" ? store.set("activeMain", tab) : null);
    } catch (err) {
      console.error("store:setActiveMain error", err);
      return null;
    }
  });

  // ====== Delete stored photos (used in Settings > Storage) ======
  safeHandle("storage:delete-stored-photos", async (_e, opts = {}) => {
    try {
      const userId = opts.userId || getUserIdFromStore();
      const eventId = opts.eventId || null;
      const { capturesDir } = getPaths(userId, eventId);

      if (!capturesDir || !fs.existsSync(capturesDir)) {
        return { ok: true, deletedCount: 0, message: "No photos directory found" };
      }

      let deleted = 0;
      const files = await fsp.readdir(capturesDir);
      for (const file of files) {
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(file)) {
          try {
            await fsp.unlink(path.join(capturesDir, file));
            deleted++;
          } catch { /* skip locked files */ }
        }
      }

      return { ok: true, deletedCount: deleted, message: `Deleted ${deleted} photo(s)` };
    } catch (err) {
      console.error("storage:delete-stored-photos error", err);
      return { ok: false, error: String(err) };
    }
  });

  // Save template thumbnail
  safeHandle("store:saveTemplateThumbnail", async (_e, { dataUrl, filename, userId }) => {
    try {
      const { assetsDir } = getPaths(userId);
      ensureDir(assetsDir);
      const safe = sanitizeFilename(filename || `template-thumb-${Date.now()}.jpg`);
      const fullPath = writeDataUrlToFile(assetsDir, safe, dataUrl);
      const uid = String(userId || getUserIdFromStore() || 'anon');
      const relativeKey = `${uid}/assets/${safe}`; // put thumbs at <user>/assets/
      return {
        ok: true, filePath: fullPath, fileUrl: toFileUrl(fullPath),
        appUrl: toAppUrl(relativeKey),
        relativeKey,
      };
    } catch (err) {
      console.error("store:saveTemplateThumbnail error", err);
      return { ok: false, error: String(err) };
    }
  });

  // Compatibility alias
  safeHandle("saveTemplateThumbnail", async (_e, dataUrl, filename) => {
    try {

      const { assetsDir } = getPaths(); // current user
      ensureDir(assetsDir);
      const safe = sanitizeFilename(filename || `template-thumb-${Date.now()}.jpg`);
      const fullPath = writeDataUrlToFile(assetsDir, safe, dataUrl);

      return { savedPath: fullPath, fileUrl: toFileUrl(fullPath) };
    } catch (err) {
      console.error("saveTemplateThumbnail error:", err);
      return { savedPath: null, fileUrl: null, error: String(err) };
    }
  });

  /* ---------------------------
     Appearance assets (per-event)
     --------------------------- */
  safeHandle("saveAppearanceLogo", async (_e, payload) => {
    try {
      const { bytes, originalName, mime, eventId, userId } = payload || {};
      if (!bytes) throw new Error("Missing bytes");
      const eventKey = String(eventId || "global");
      const { assetsDir } = getPaths(userId);
      const baseDir = path.join(assetsDir, eventKey);
      const ext = mimeToExt(mime) || path.extname(originalName || "") || ".png";
      const baseName =
        (originalName && path.basename(originalName, path.extname(originalName))) ||
        `logo-${eventKey}-${Date.now()}`;
      const filename = sanitizeFilename(baseName) + ext;

      const fullPath = writeBytesToFile(baseDir, filename, bytes);
      const uid = String(userId || getUserIdFromStore() || 'anon');
      const relativeKey = `${uid}/assets/${eventKey}/${filename}`;
      return {
        ok: true,
        savedPath: fullPath,
        fileUrl: toFileUrl(fullPath),
        appUrl: toAppUrl(relativeKey),
        relativeKey,
      };
    } catch (err) {
      console.error("saveAppearanceLogo error:", err);
      return { ok: false, savedPath: null, fileUrl: null, error: String(err) };
    }
  });

  safeHandle("saveAppearanceBackground", async (_e, payload) => {
    try {
      const { bytes, dataUrl, originalName, mime, eventId, userId } = payload || {};
      const eventKey = String(eventId || "global");
      const { assetsDir } = getPaths(userId);
      const baseDir = path.join(assetsDir, eventKey);
      let filename, fullPath;
      if (bytes) {
        const ext = mimeToExt(mime) || path.extname(originalName || "") || ".mp4";
        const baseName =
          (originalName && path.basename(originalName, path.extname(originalName))) ||
          `background-${eventKey}-${Date.now()}`;
        filename = sanitizeFilename(baseName) + ext;
        fullPath = writeBytesToFile(baseDir, filename, bytes);
      } else if (dataUrl) {
        const m = (String(dataUrl).match(/^data:(.+?);base64,/) || [])[1] || mime || "image/png";
        const ext = mimeToExt(m) || ".png";
        const baseName =
          (originalName && path.basename(originalName, path.extname(originalName))) ||
          `background-${eventKey}-${Date.now()}`;
        filename = sanitizeFilename(baseName) + ext;
        fullPath = writeDataUrlToFile(baseDir, filename, dataUrl);
      } else {
        throw new Error("Missing bytes or dataUrl");
      }

      const uid = String(userId || getUserIdFromStore() || 'anon');
      const relativeKey = `${uid}/assets/${eventKey}/${filename}`;

      return {
        ok: true,
        savedPath: fullPath,
        fileUrl: toFileUrl(fullPath),
        appUrl: toAppUrl(relativeKey),
        relativeKey,
      };
    } catch (err) {
      console.error("saveAppearanceBackground error:", err);
      return { ok: false, savedPath: null, fileUrl: null, error: String(err) };
    }
  });

  safeHandle("resolveAppearanceUrl", async (_e, { savedPath, relativeKey } = {}) => {
    try {
      if (savedPath) {
        return { ok: true, url: toFileUrl(savedPath), kind: "file" };
      }
      if (relativeKey) {
        const rel = sanitizeRelKey(relativeKey);
        return { ok: true, url: toAppUrl(rel), kind: "app" };
      }
      throw new Error("Neither savedPath nor relativeKey provided");
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  safeHandle("deleteAppearanceAsset", async (_e, pathOrUrl) => {
    try {
      if (!pathOrUrl) return { ok: false, error: "no path" };
      const p = path.resolve(fromFileUrl(pathOrUrl));
      if (!p.startsWith(USERDATA)) {
        return { ok: false, error: "Path outside application data directory" };
      }
      if (fs.existsSync(p)) {
        await fsp.unlink(p);
        return { ok: true };
      }
      return { ok: false, error: "file not found" };
    } catch (err) {
      console.error("deleteAppearanceAsset error:", err);
      return { ok: false, error: String(err) };
    }
  });

  // ===== Printers: status + test (React calls window.electron.invoke) =====
  const { dialog } = require("electron");

  // main.js — enhance printer:status
  safeHandle("printer:status", async (event, printerName) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const list = await win.webContents.getPrintersAsync();
      const printer = list.find(p => p.name === String(printerName || ""));

      if (!printer) return { online: false, name: printerName };

      // Check printer status codes (Electron/Chromium printer status)
      // status: 0 = idle, 3 = printing, 4 = stopped
      const statusMap = { 0: "idle", 3: "printing", 4: "error" };

      return {
        online: printer.status !== 4,
        status: statusMap[printer.status] || "unknown",
        name: printer.name,
        isDefault: printer.isDefault,
        message: printer.status === 0 ? "Printer is ready" :
          printer.status === 3 ? "Printer is printing" :
            printer.status === 4 ? "Printer error" : "Unknown status"
      };
    } catch (err) {
      return { online: false, error: String(err) };
    }
  });

  safeHandle("printer:list", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win.webContents.getPrintersAsync();
  });

  // ── Photo-lab strip profile management (DNP + HiTi) ─────────────────────
  safeHandle("printer:dnpScan", async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const all = await win.webContents.getPrintersAsync();
      const allNames = new Set(all.map((p) => p.name));

      // Match DNP (DS-series, Imagingcomm, Citizen DP-S) and HiTi (P-series)
      const BRAND_RE = /DNP|HiTi|Hi-Ti|HITI|DS620|DS820|DS-RX|DS40|DS80|DS23|DP-S|Imagingcomm|P510S|P520L|P525L|P528L|P720L|P728L|P750L/i;

      const matched = all.filter((p) => {
        const n = p.name ?? "";
        const d = p.description ?? "";
        // Exclude printers that are themselves STRIP profiles
        if (/-STRIP$/i.test(n)) return false;
        return BRAND_RE.test(n) || BRAND_RE.test(d);
      });

      const results = matched.map((p) => {
        const brandStr = (p.name + " " + (p.description ?? "")).toLowerCase();
        const brand = /hiti|hi-ti|hi_ti/.test(brandStr) ? "HiTi" : "DNP";
        const stripProfileName = `${p.name}-STRIP`;
        const hasStripProfile = allNames.has(stripProfileName);
        return {
          name: p.name,
          driver: p.description ?? "",
          brand,
          stripProfileName,
          hasStripProfile,
        };
      });

      const allPrinters = all.map((p) => ({ name: p.name, driver: p.description ?? "" }));
      return { ok: true, printers: results, allPrinters };
    } catch (err) {
      return { ok: false, printers: [], allPrinters: [], error: err.message };
    }
  });

  safeHandle("printer:createStripProfile", async (event, payload) => {
    const printerName = typeof payload === "string" ? payload : payload?.printerName;
    if (!printerName) return { ok: false, error: "printerName required" };
    const stripName = `${printerName}-STRIP`;
    const { execSync } = require("child_process");
    const safeSrc  = printerName.replace(/'/g, "''");
    const safeDest = stripName.replace(/'/g, "''");

    const { execFileSync } = require("child_process");
    const printui = `${process.env.SystemRoot || "C:\\Windows"}\\System32\\printui.exe`;

    // Step 1: Read source printer driver + port via WMI (no PrintManagement needed)
    let driverName, portName;
    try {
      const infoRaw = execSync(
        `powershell -NoProfile -NonInteractive -Command ` +
        `"$p=Get-WmiObject Win32_Printer -Filter \\"Name='${safeSrc}'\\" -ErrorAction Stop; $p.DriverName+'|'+$p.PortName"`,
        { timeout: 6000, encoding: "utf8", windowsHide: true }
      ).trim();
      [driverName, portName] = infoRaw.split("|");
    } catch (err) {
      return { ok: false, error: `Could not read printer info: ${err.message}` };
    }
    if (!driverName || !portName) {
      return { ok: false, error: "Could not read driver/port. Is the printer driver installed?" };
    }

    // Step 2: Create the STRIP printer via printui.exe
    // NOTE: Win32_Printer.SpawnInstance().Put() is intentionally avoided — it renames the original.
    let created = false;
    try {
      execFileSync(printui, ["/if", "/b", stripName, "/r", portName, "/m", driverName, "/Z"], {
        timeout: 15000, windowsHide: true,
      });
      created = true;
    } catch { /* fall through */ }

    if (!created) {
      // Fallback: Add-Printer (requires PrintManagement module)
      try {
        const safeDriver = driverName.replace(/'/g, "''");
        const safePort   = portName.replace(/'/g, "''");
        execSync(
          `powershell -NoProfile -NonInteractive -Command ` +
          `"Add-Printer -Name '${safeDest}' -DriverName '${safeDriver}' -PortName '${safePort}' -ErrorAction Stop"`,
          { timeout: 10000, encoding: "utf8", windowsHide: true }
        );
        created = true;
      } catch (err) {
        return { ok: false, error: `Could not create STRIP profile. Try running Photuna as Administrator.\n${err.message}` };
      }
    }

    // Step 3: Apply 2inch cut=Enable DEVMODE to the new STRIP printer.
    // Strategy: we do NOT copy from the main printer (it has 2inch cut=Disable).
    // Instead, on first creation we open the STRIP printer's Printing Preferences
    // so the user sets it once. After they save it, a "Save Setting" button in the
    // UI calls printer:saveStripDevmode which reads the saved DEVMODE and stores it
    // to userData. On all future recreations we read that saved file and apply it
    // via SetPrinter level 9 — fully automatic with no prompts.
    let cutModeApplied = false;
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const { spawnSync, execFile } = require("child_process");
      const fs2 = require("fs");
      const path2 = require("path");

      const userData = app.getPath("userData");
      // Versioned filename — bump suffix when C# source changes to force recompile
      // v7: read source DEVMODE from HKCU\Printers\DevModes2\{src} directly.
      // v9 helper: two modes.
      // --save {printer} {file}       → GetPrinter(level 9) → write DEVMODE bytes to file
      // --apply-file {file} {printer} → read file → patch dmDeviceName → SetPrinter(level 9)
      const helperExe = path2.join(userData, "ph_devmode_helper_v9.exe");
      const compileHelper = () => {
        const csSource = [
          "using System;",
          "using System.IO;",
          "using System.Runtime.InteropServices;",
          "using System.Text;",
          "class P {",
          "  [DllImport(\"winspool.drv\",CharSet=CharSet.Unicode,SetLastError=true)]",
          "  static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);",
          "  [DllImport(\"winspool.drv\",SetLastError=true)]",
          "  static extern bool ClosePrinter(IntPtr h);",
          "  [DllImport(\"winspool.drv\",SetLastError=true)]",
          "  static extern bool SetPrinter(IntPtr h,int l,IntPtr b,int c);",
          "  [DllImport(\"winspool.drv\",CharSet=CharSet.Unicode,SetLastError=true)]",
          "  static extern bool GetPrinter(IntPtr h,int l,IntPtr b,int s,out int n);",
          "  static int Main(string[] a) {",
          "    Console.Error.WriteLine(\"START args=\"+string.Join(\" \",a));",
          "    try {",
          "      if(a.Length<3){Console.Error.WriteLine(\"usage: --save printer file | --apply-file file printer\");return 1;}",
          "      if(a[0]==\"--save\"){",
          // --save mode: read per-user DEVMODE from printer and save to file
          "        string src=a[1],file=a[2];",
          "        IntPtr sh=IntPtr.Zero;",
          "        if(!OpenPrinter(src,out sh,IntPtr.Zero)){Console.Error.WriteLine(\"OpenSrc:\"+Marshal.GetLastWin32Error());return 1;}",
          "        int n=0; GetPrinter(sh,9,IntPtr.Zero,0,out n);",
          "        Console.Error.WriteLine(\"PI9 needed=\"+n);",
          "        if(n<=0){ClosePrinter(sh);Console.Error.WriteLine(\"PI9 size=0\");return 1;}",
          "        IntPtr buf=Marshal.AllocHGlobal(n+256);",
          "        if(!GetPrinter(sh,9,buf,n,out n)){ClosePrinter(sh);Console.Error.WriteLine(\"GetPrinter9:\"+Marshal.GetLastWin32Error());return 1;}",
          "        ClosePrinter(sh);",
          "        IntPtr pdm=Marshal.ReadIntPtr(buf,0);",
          "        Console.Error.WriteLine(\"pDevMode=\"+(pdm==IntPtr.Zero?\"null\":\"ok\"));",
          "        if(pdm==IntPtr.Zero){Console.WriteLine(\"NO_USER_DEVMODE\");return 2;}",
          "        short dmFix=(short)Marshal.ReadInt16(pdm,68);",
          "        short dmExt=(short)Marshal.ReadInt16(pdm,70);",
          "        int dmLen=(int)dmFix+(int)dmExt;",
          "        Console.Error.WriteLine(\"dmLen=\"+dmLen);",
          "        if(dmLen<=0||dmLen>1048576){Console.Error.WriteLine(\"bad dmLen\");return 1;}",
          "        byte[] dm=new byte[dmLen];",
          "        Marshal.Copy(pdm,dm,0,dmLen);",
          "        File.WriteAllBytes(file,dm);",
          "        Console.Error.WriteLine(\"saved \"+dmLen+\" bytes\");",
          "        Console.WriteLine(\"OK\");return 0;",
          "      } else if(a[0]==\"--apply-file\"){",
          // --apply-file mode: read DEVMODE from file and write to printer
          "        string file=a[1],dst=a[2];",
          "        if(!File.Exists(file)){Console.Error.WriteLine(\"file not found\");return 1;}",
          "        byte[] dm=File.ReadAllBytes(file);",
          "        Console.Error.WriteLine(\"read \"+dm.Length+\" bytes\");",
          // Patch dmDeviceName (WCHAR[32] = first 64 bytes) to match destination
          "        byte[] nb=new byte[64];",
          "        byte[] de=Encoding.Unicode.GetBytes(dst.Length>31?dst.Substring(0,31):dst);",
          "        Array.Copy(de,nb,Math.Min(de.Length,62));",
          "        Array.Copy(nb,0,dm,0,64);",
          "        Console.Error.WriteLine(\"name patched\");",
          // Copy to unmanaged buffer and apply via SetPrinter level 9
          "        IntPtr udm=Marshal.AllocHGlobal(dm.Length+256);",
          "        Marshal.Copy(dm,0,udm,dm.Length);",
          "        IntPtr dh=IntPtr.Zero;",
          "        if(!OpenPrinter(dst,out dh,IntPtr.Zero)){Console.Error.WriteLine(\"OpenDst:\"+Marshal.GetLastWin32Error());return 1;}",
          "        IntPtr pi=Marshal.AllocHGlobal(IntPtr.Size);",
          "        Marshal.WriteIntPtr(pi,udm);",
          "        bool ok9=SetPrinter(dh,9,pi,0);",
          "        int e9=Marshal.GetLastWin32Error();",
          "        Console.Error.WriteLine(\"L9=\"+ok9+\" e=\"+e9);",
          "        ClosePrinter(dh);",
          "        if(ok9){Console.WriteLine(\"OK\");return 0;}",
          "        return 1;",
          "      }",
          "      Console.Error.WriteLine(\"unknown mode\");return 1;",
          "    }catch(Exception ex){Console.Error.WriteLine(\"EX:\"+ex.Message);return 1;}",
          "  }",
          "}",
        ].join("\r\n");
        const csFile = path2.join(userData, "ph_devmode_helper_v9.cs");
        fs2.writeFileSync(csFile, csSource, "utf8");
        const sysRoot = process.env.SystemRoot || "C:\\Windows";
        const cscCandidates = [
          path2.join(sysRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
          path2.join(sysRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
        ];
        const cscExe = cscCandidates.find((p) => fs2.existsSync(p));
        if (!cscExe) { console.warn("[DEVMODE] csc.exe not found"); return false; }
        const cr = spawnSync(cscExe, ["/nologo", "/optimize+", `/out:${helperExe}`, csFile], {
          timeout: 20000, encoding: "utf8", windowsHide: true,
        });
        console.log("[DEVMODE] compile status:", cr.status, cr.stderr?.trim() || "");
        try { fs2.unlinkSync(csFile); } catch {}
        return cr.status === 0;
      };

      if (!fs2.existsSync(helperExe)) compileHelper();

      // Saved DEVMODE file from a previous "Save 2inch Cut Setting" action.
      // Key is based on the source printer name (e.g. DS-RX1).
      const safeKey = printerName.replace(/[^a-z0-9]/gi, "_");
      const devmodeFile = path2.join(userData, `strip_devmode_${safeKey}.bin`);

      if (fs2.existsSync(devmodeFile) && fs2.existsSync(helperExe)) {
        // Saved DEVMODE from a previous session → apply it automatically
        const result = spawnSync(helperExe, ["--apply-file", devmodeFile, stripName], {
          timeout: 10000, encoding: "utf8", windowsHide: true,
        });
        const stdout = (result.stdout || "").trim();
        console.log("[DEVMODE] apply-file status:", result.status, "| stdout:", stdout, "| stderr:", (result.stderr || "").trim());
        cutModeApplied = stdout === "OK";
      } else {
        // First time or saved file was cleared — open Printing Preferences for DS-RX1-STRIP
        // so the user can set 2inch cut=Enable once. They then click "Save Setting" in the UI,
        // which calls printer:saveStripDevmode and stores the DEVMODE for future automatic use.
        const { execFile: execFile2 } = require("child_process");
        const safeStripName = stripName.replace(/"/g, "");
        execFile2("rundll32.exe", ["printui.dll,PrintUIEntry", "/e", "/n", safeStripName], {
          windowsHide: false,
        });
        console.log("[DEVMODE] opened Printing Preferences for first-time 2inch cut setup");
        return { ok: true, stripName, cutModeApplied: false, needsManualSetup: true };
      }
    } catch (err) {
      console.warn("[DEVMODE] error:", err?.message);
    }

    return { ok: true, stripName, cutModeApplied };
  });

  // Open Printing Preferences dialog for a printer
  safeHandle("printer:openPrinterPrefs", async (_e, { printerName } = {}) => {
    if (!printerName) return { ok: false, error: "printerName required" };
    const { execFile } = require("child_process");
    const safe = printerName.replace(/"/g, "");
    execFile("rundll32.exe", ["printui.dll,PrintUIEntry", "/e", "/n", safe], { windowsHide: false });
    return { ok: true };
  });

  // Save the per-user DEVMODE from a configured STRIP printer to userData so future
  // recreations of the STRIP profile can apply 2inch cut=Enable automatically.
  safeHandle("printer:saveStripDevmode", async (_e, { stripProfileName, printerKey } = {}) => {
    if (!stripProfileName || !printerKey) return { ok: false, error: "stripProfileName and printerKey required" };
    try {
      const { spawnSync } = require("child_process");
      const fs2 = require("fs");
      const path2 = require("path");
      const userData = app.getPath("userData");
      const helperExe = path2.join(userData, "ph_devmode_helper_v9.exe");
      if (!fs2.existsSync(helperExe)) return { ok: false, error: "Helper not compiled — create STRIP profile first" };

      const safeKey = printerKey.replace(/[^a-z0-9]/gi, "_");
      const devmodeFile = path2.join(userData, `strip_devmode_${safeKey}.bin`);

      const result = spawnSync(helperExe, ["--save", stripProfileName, devmodeFile], {
        timeout: 10000, encoding: "utf8", windowsHide: true,
      });
      const stdout = (result.stdout || "").trim();
      const stderr = (result.stderr || "").trim();
      console.log("[DEVMODE] save status:", result.status, "| stdout:", stdout, "| stderr:", stderr);

      if (stdout === "OK") return { ok: true };
      if (stdout === "NO_USER_DEVMODE") return { ok: false, error: "no_user_devmode" };
      return { ok: false, error: `Helper exited ${result.status}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  safeHandle("printer:setCutMode", async (_e, { printerName, propertyName, value } = {}) => {
    if (!printerName || !propertyName || value == null) {
      return { ok: false, error: "printerName, propertyName, and value are required" };
    }
    try {
      const { execSync } = require("child_process");
      const safeName = printerName.replace(/'/g, "''");
      const safeProp = propertyName.replace(/'/g, "''");
      const safeVal  = String(value).replace(/'/g, "''");

      // Try Set-PrinterProperty first (requires PrintManagement)
      try {
        execSync(
          `powershell -NoProfile -NonInteractive -Command ` +
          `"Set-PrinterProperty -PrinterName '${safeName}' -PropertyName '${safeProp}' -Value '${safeVal}'"`,
          { timeout: 8000, encoding: "utf8", windowsHide: true }
        );
        return { ok: true, method: "Set-PrinterProperty" };
      } catch { /* fall through to registry */ }

      // Fallback: write directly to the registry PrinterDriverData key
      const regPaths = [
        `HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers\\${safeName}\\PrinterDriverData`,
        `HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Print\\Printers\\${safeName}\\PrinterDriverData`,
      ];
      let regOk = false;
      for (const regPath of regPaths) {
        try {
          execSync(
            `powershell -NoProfile -NonInteractive -Command ` +
            `"Set-ItemProperty -Path '${regPath}' -Name '${safeProp}' -Value '${safeVal}' -ErrorAction Stop"`,
            { timeout: 6000, encoding: "utf8", windowsHide: true }
          );
          regOk = true;
          break;
        } catch { /* try next path */ }
      }
      if (regOk) return { ok: true, method: "registry" };
      return { ok: false, error: "Could not set property via Set-PrinterProperty or registry. Try running the app as Administrator." };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Generic meta-flag store (used for one-time injection flags) ───────────
  safeHandle("store:getMetaFlag", (_e, { userId, flag } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.meta.${flag}`;
      return store.get(key) ?? null;
    } catch { return null; }
  });

  safeHandle("store:setMetaFlag", (_e, { userId, flag, value } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.meta.${flag}`;
      store.set(key, value);
      return true;
    } catch { return false; }
  });

  safeHandle("storage:delete-all", async (_e, pathOrOpts) => {
    try {
      const targetPath = typeof pathOrOpts === "string"
        ? pathOrOpts
        : pathOrOpts?.path;

      if (!targetPath) return { ok: false, error: "No path provided" };

      const resolved = path.resolve(targetPath);
      if (!resolved.startsWith(USERDATA)) {
        return { ok: false, error: "Path outside application data directory" };
      }

      let deleted = 0;

      // Recursive walk — compatible with all Node versions
      async function deleteAll(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await deleteAll(full);
          } else {
            try { await fsp.unlink(full); deleted++; } catch { }
          }
        }
      }

      await deleteAll(targetPath);
      return { ok: true, message: `Deleted ${deleted} files`, deletedCount: deleted };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  safeHandle("app:restart", async () => {
    app.relaunch();
    app.exit(0);
  });

  safeHandle("printer:test", async (event, printJob) => {
    let printWindow = null;
    try {
      const job =
        typeof printJob === "string"
          ? { printer: printJob }
          : (printJob || {});

      const printerName = job.printer || job.name || job.deviceName || "";
      if (!printerName) throw new Error("No printer selected");

      // simple test page
      printWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
      await printWindow.loadURL(`data:text/html;charset=utf-8,` +
        encodeURIComponent(`
          <html>
            <body style="font-family: Arial, sans-serif; margin: 24px;">
              <h1>Studio Photuna Test</h1>
              <p>${new Date().toISOString()}</p>
              <p>Printer: ${String(printerName)}</p>
              <p>Layout: ${String(job.layout || "4x6")}</p>
              <p>Paper: ${String(job.paperSize || "default")}</p>
            </body>
          </html>
        `));

      const success = await new Promise((resolve, reject) => {
        printWindow.webContents.print({
          deviceName: String(printerName),
          silent: false,
          copies: Number(job.copies || 1),
          color: job.colorMode !== "grayscale",
          landscape: job.orientation === "landscape",
          duplexMode: job.duplexMode || "simplex",
        }, (didPrint, failureReason) => {
          if (didPrint) resolve(true);
          else reject(new Error(failureReason || "Print job was not completed"));
        });
      });

      return { ok: success, printer: printerName };
    } catch (err) {
      console.error("printer:test error", err);
      return { ok: false, error: String(err) };
    } finally {
      if (printWindow && !printWindow.isDestroyed()) printWindow.close();
    }
  });

  // ===== Storage folder picker =====
  safeHandle("storage:select", async () => {
    try {
      const res = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
      if (res.canceled || !res.filePaths?.length) return null;
      return res.filePaths[0];
    } catch (err) {
      console.error("storage:select error", err);
      return null;
    }
  });

  // ===== Export logs (very simple trace bundle) =====
  safeHandle("log:export", async () => {
    try {
      const exportDir = path.join(USERDATA, "logs");
      ensureDir(exportDir);
      const file = path.join(exportDir, `export-${Date.now()}.txt`);

      // collect a few core blobs
      const blobs = [];
      try {
        const { eventsFile } = getPaths(); // current user
        blobs.push({ key: "events.json", data: fs.readFileSync(eventsFile, "utf8") });
      } catch { }
      try {
        const settings = (typeof store.getSettings === "function" ? store.getSettings() : store.get("settings")) || {};
        blobs.push({ key: "settings.json", data: JSON.stringify(settings, null, 2) });
      } catch { }

      const content = [
        `Studio Photuna Booth App Log Export`,
        `Date: ${new Date().toISOString()}`,
        `App: ${APP_FULL_NAME}`,
        `OS: ${os.type()} ${os.arch()} ${os.release()}`,
        ``,
        ...blobs.map(b => `----- ${b.key} -----\n${b.data}\n`)
      ].join("\n");

      fs.writeFileSync(file, content, "utf8");
      return file; // renderer expects a path-like return it can toast
    } catch (err) {
      console.error("log:export error", err);
      return null;
    }
  });

  // ===== Startup (login item) toggle =====
  safeHandle("startup:set", async (_e, enabled) => {
    try {
      // Persist pref
      if (typeof store.set === "function") store.set("startup.enabled", !!enabled);

      // Apply OS setting (macOS/Windows)
      app.setLoginItemSettings({
        openAtLogin: !!enabled,
        openAsHidden: false
      });
      return { ok: true };
    } catch (err) {
      console.error("startup:set error", err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle("app:setAutoUpdate", async (_e, enabled) => {
    try {
      autoUpdater.autoDownload = !!enabled;
      autoUpdater.autoInstallOnAppQuit = !!enabled;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });


  // === IPC: preview lifecycle ===
  safeHandle('preview:startServer', async () => startPreviewServer());

  safeHandle('preview:createSession', async (_e, payload = {}) => {
    const uid = getUserIdFromStore();
    const base = startPreviewServer(); // ensure server is up
    const sessionId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 6);
    const token = crypto.randomBytes(16).toString('base64url');
    const dir = getSessionDir(uid, sessionId);
    ensureDir(dir);
    const meta = {
      sessionId,
      token,
      createdAt: new Date().toISOString(),
      shots: [],
      slots: [],
      finalPrint: null,
      animatedComposite: null,
      layout: payload?.layout || { width: 1200, height: 800, slots: [] }
    };
    writeJson(path.join(dir, 'session.json'), meta);
    return { sessionId, token, previewUrl: `${base}/p/${token}` };
  });

  safeHandle('preview:getUrl', async (_e, tokenOrSession) => {
    const base = startPreviewServer();
    return `${base}/p/${tokenOrSession}`;
  });

  safeHandle('preview:saveStill', async (_e, sessionId, slotIndex, dataUrl, extra = {}) => {
    try {
      const uid = extra?.userId || getUserIdFromStore();
      const eventId = extra?.eventId || "default";
      const storagePath = extra?.storagePath || "";

      const { capturesDir, metaFile } = resolveBoothOutputDirs({
        userId: uid,
        eventId,
        sessionId,
        storagePath,
      });

      const safeIndex = String(slotIndex).padStart(2, "0");
      const file = path.join(capturesDir, `shot_${safeIndex}.jpg`);
      const m = String(dataUrl).match(/^data:(.+?);base64,(.+)$/);
      if (!m) return { ok: false, error: 'invalid_dataurl' };

      fs.writeFileSync(file, Buffer.from(m[2], 'base64'));

      const meta = readJson(metaFile, {});
      meta.shots = Array.isArray(meta.shots) ? meta.shots : [];
      meta.slots = Array.isArray(meta.slots) ? meta.slots : [];

      const sid = `shot_${slotIndex}`;
      const rec = { id: sid, path: `captures/shot_${safeIndex}.jpg` };
      const existing = meta.shots.find(x => x.id === sid);
      if (existing) Object.assign(existing, rec);
      else meta.shots.push(rec);

      const slotId = `slot${slotIndex}`;
      let slot = meta.slots.find(x => x.id === slotId);
      if (!slot) {
        slot = { id: slotId };
        meta.slots.push(slot);
      }
      slot.image = `captures/shot_${safeIndex}.jpg`;

      writeJson(metaFile, meta);
      return { ok: true, filePath: file, fileUrl: toFileUrl(file) };
    } catch (err) {
      console.error("preview:saveStill error:", err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle('preview:saveSlotClip', async (_e, sessionId, slotIndex, byteArray, extra = {}) => {
    try {
      const uid = extra?.userId || getUserIdFromStore();
      const eventId = extra?.eventId || "default";
      const storagePath = extra?.storagePath || "";

      const { burstDir, metaFile } = resolveBoothOutputDirs({
        userId: uid,
        eventId,
        sessionId,
        storagePath,
      });

      const rawPath = path.join(burstDir, `slot${slotIndex}_raw.webm`);
      fs.writeFileSync(rawPath, Buffer.from(Uint8Array.from(byteArray || [])));

      const result = await transcodeSlotClip(burstDir, slotIndex);

      const meta = readJson(metaFile, {});
      meta.burst = Array.isArray(meta.burst) ? meta.burst : [];
      meta.slots = Array.isArray(meta.slots) ? meta.slots : [];

      const burstId = `slot${slotIndex}`;

      const existingBurst = meta.burst.find((x) => x.id === burstId);

      const burstRecord = {
        id: burstId,
        slotIndex,
        raw: `burst/slot${slotIndex}_raw.webm`,
        mp4: `burst/slot${slotIndex}.mp4`,
        gif: `burst/slot${slotIndex}.gif`,
        createdAt: new Date().toISOString(),
      };

      if (existingBurst) {
        Object.assign(existingBurst, burstRecord);
      } else {
        meta.burst.push(burstRecord);
      }

      const slotId = `slot${slotIndex}`;
      let slot = meta.slots.find(x => x.id === slotId);
      if (!slot) {
        slot = { id: slotId };
        meta.slots.push(slot);
      }
      slot.video = `burst/slot${slotIndex}.mp4`;
      slot.gif = `burst/slot${slotIndex}.gif`;

      writeJson(metaFile, meta);

      return { ok: true, ...result };
    } catch (err) {
      console.error("preview:saveSlotClip error:", err);
      return { ok: false, error: String(err) };
    }
  });

  console.log("store handlers for templates and palettes registered");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ====== Preview server (Express) + IPC ======
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT || 3977);
let previewServer = null;

function getLanAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return `http://${net.address}:${PREVIEW_PORT}`;
      }
    }
  }
  return `http://localhost:${PREVIEW_PORT}`;
}

function indexByToken(previewRootAbs) {
  const map = new Map();
  if (!fs.existsSync(previewRootAbs)) return map;
  for (const sid of fs.readdirSync(previewRootAbs)) {
    const file = path.join(previewRootAbs, sid, 'session.json');
    if (fs.existsSync(file)) {
      const meta = readJson(file, null);
      if (meta?.token) map.set(meta.token, { dir: path.join(previewRootAbs, sid), meta });
    }
  }
  return map;
}

function startPreviewServer() {
  if (previewServer) return getLanAddress();
  const appx = express();
  // Keep routes minimal; helmet/cors optional on LAN
  // API
  appx.get('/api/session/:token', (req, res) => {
    try {
      const uid = getUserIdFromStore();
      const root = getPreviewRoot(uid);
      const entry = indexByToken(root).get(req.params.token);
      if (!entry) return res.status(404).end();
      const { dir, meta } = entry;

      const toUrl = (p) => {
        if (!p) return null;
        // Encode each path segment, keep slashes
        return `/media/${meta.token}/${String(p).split('/').map(encodeURIComponent).join('/')}`;
      };

      res.json({
        sessionId: meta.sessionId,
        createdAt: meta.createdAt,
        shots: (meta.shots || []).map(s => ({ ...s, url: toUrl(s.path) })),
        slots: (meta.slots || []).map(s => ({
          ...s,
          imageUrl: toUrl(s.image),
          videoUrl: toUrl(s.video),
          gifUrl: toUrl(s.gif),
        })),
        finalPrintUrl: toUrl(meta.finalPrint),
        animatedCompositeUrl: toUrl(meta.animatedComposite),
        layout: meta.layout
      });
    } catch (e) {
      res.status(500).json({ error: 'server_error' });
    }
  });
  // Media streaming (token-scoped)
  appx.get('/media/:token/:rel', async (req, res) => {
    try {
      // Recompute the preview root for the current user
      const uid = getUserIdFromStore();
      const previewRootAbs = getPreviewRoot(uid);

      // Map token -> session directory by scanning session.json files
      const entry = indexByToken(previewRootAbs).get(req.params.token);
      if (!entry) return res.status(404).end();

      // Support nested rel paths like "video/slot1.gif" or "originals/shot_0.jpg"
      const prefix = `/media/${req.params.token}/`;
      const fullUrl = req.url;                                     // e.g. /media/<token>/video/slot1.gif
      const rel = decodeURIComponent(fullUrl.slice(prefix.length)); // "video/slot1.gif"

      // Normalize + traversal guard
      const safeRel = rel.replace(/\\/g, '/');
      const abs = path.resolve(entry.dir, safeRel);
      const inside = !path.relative(entry.dir, abs).startsWith('..');
      if (!inside) return res.status(403).end();

      if (!fs.existsSync(abs)) return res.status(404).end();

      res.setHeader('Content-Type', mime.getType(abs) || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      fs.createReadStream(abs).pipe(res);
    } catch (e) {
      console.error('[Preview] media route error:', e);
      res.status(500).end();
    }
  });
  // Serve built SPA from resources/preview-client (optional)
  const clientDir = path.join(process.resourcesPath, 'preview-client');
  if (fs.existsSync(clientDir)) {
    appx.use(express.static(clientDir));
    appx.get('/p/:token', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  } else {
    // dev fallback: simple page
    appx.get('/p/:token', (req, res) => {
      const safe = String(req.params.token).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      res.end(`<html><body><div>Preview token: ${safe}</div></body></html>`);
    });
  }
  previewServer = appx.listen(PREVIEW_PORT, () => {
    console.log('[Preview] Serving client from:', clientDir, 'exists?', fs.existsSync(clientDir));
    console.log(`Preview server on ${getLanAddress()}`);
  });
  return getLanAddress();
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});