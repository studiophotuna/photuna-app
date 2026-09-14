// src/utils/toneSpec.js
//
// Everything a booth needs to apply a tone (filter) to a photo: the built-in
// presets, operator-made tones built from adjustment sliders, and imported 3D
// LUTs (.cube files from Lightroom, Photoshop, DaVinci and most LUT packs).
//
// A tone that an operator applies to an event carries its full definition with
// it (see toneToCustomSpec), so an event synced to another booth PC renders the
// same colours there without needing that PC's tone library.
//
// No DOM here except renderLutPreview, so the maths is testable in Node.

export const PRESET_TONE_FILTERS = {
  normal:  "none",
  bw:      "grayscale(1) contrast(1.15)",
  sepia:   "sepia(1) contrast(1.1)",
  vintage: "sepia(0.35) contrast(1.1) saturate(0.75)",
  warm:    "brightness(1.05) hue-rotate(15deg) saturate(1.15)",
  cool:    "brightness(1.02) hue-rotate(-20deg) saturate(1.1) contrast(1.05)",
  vivid:   "brightness(1.1) contrast(1.1) saturate(1.4)",
  party:   "brightness(1.15) contrast(1.15) saturate(1.5)",
  soft:    "brightness(1.25) contrast(0.88) saturate(0.8)",
  dreamy:  "brightness(1.15) contrast(0.9) saturate(0.75) hue-rotate(5deg)",
  drama:   "brightness(0.88) contrast(1.4) saturate(1.15)",
  film:    "contrast(1.1) saturate(0.85) hue-rotate(-5deg)",
};

// Stored LUTs are resampled to at most this size. 33 points per axis is what
// most grading tools export and is visually lossless for photos; it keeps one LUT
// near 145 KB in the synced event data instead of up to 1 MB for a 65-point one.
export const MAX_LUT_SIZE = 33;
export const MAX_CUBE_FILE_BYTES = 20 * 1024 * 1024;

export const ADJUSTMENT_LIMITS = {
  brightness: { min: 0.5, max: 1.5, step: 0.01, neutral: 1 },
  contrast:   { min: 0.5, max: 1.8, step: 0.01, neutral: 1 },
  saturation: { min: 0,   max: 2,   step: 0.01, neutral: 1 },
  hue:        { min: -45, max: 45,  step: 1,    neutral: 0 },
  sepia:      { min: 0,   max: 1,   step: 0.01, neutral: 0 },
};

function clamp(value, min, max, fallback) {
  // Number(null) is 0, which would turn "not set" into "no brightness".
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeAdjustments(meta = {}) {
  const out = {};
  for (const [key, lim] of Object.entries(ADJUSTMENT_LIMITS)) {
    out[key] = clamp(meta?.[key], lim.min, lim.max, lim.neutral);
  }
  return out;
}

/** CSS filter string for slider adjustments; the booth's pixel pipeline parses the same string. */
export function adjustmentsToCss(meta) {
  const m = normalizeAdjustments(meta);
  const parts = [];
  if (m.saturation === 0) parts.push("grayscale(1)");
  if (m.sepia > 0) parts.push(`sepia(${m.sepia})`);
  if (m.saturation > 0 && m.saturation !== 1) parts.push(`saturate(${m.saturation})`);
  if (m.hue !== 0) parts.push(`hue-rotate(${m.hue}deg)`);
  if (m.brightness !== 1) parts.push(`brightness(${m.brightness})`);
  if (m.contrast !== 1) parts.push(`contrast(${m.contrast})`);
  return parts.length ? parts.join(" ") : "none";
}

/* ------------------------------ .cube parsing ------------------------------ */

function numbersAfterKeyword(line) {
  return line.trim().split(/\s+/).slice(1).map(Number);
}

/**
 * Parse an Adobe/Resolve .cube 3D LUT. Returns float output values with red
 * varying fastest, as the format specifies. Throws a message an operator can act on.
 */
export function parseCubeLut(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("The file is empty.");

  let title = "";
  let size = 0;
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  const values = [];

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const keyword = line.split(/\s+/)[0].toUpperCase();
    if (keyword === "TITLE") {
      title = line.slice(5).trim().replace(/^"|"$/g, "");
      continue;
    }
    if (keyword === "LUT_1D_SIZE") {
      throw new Error("This is a 1D LUT. Export a 3D LUT (a .cube file with LUT_3D_SIZE) instead.");
    }
    if (keyword === "LUT_3D_SIZE") {
      size = Number(line.split(/\s+/)[1]);
      continue;
    }
    if (keyword === "DOMAIN_MIN") {
      domainMin = numbersAfterKeyword(line);
      continue;
    }
    if (keyword === "DOMAIN_MAX") {
      domainMax = numbersAfterKeyword(line);
      continue;
    }
    if (keyword === "LUT_3D_INPUT_RANGE") {
      const [lo, hi] = numbersAfterKeyword(line);
      domainMin = [lo, lo, lo];
      domainMax = [hi, hi, hi];
      continue;
    }
    if (/^[A-Z_]/.test(keyword)) continue; // other keywords carry nothing we use

    const parts = line.split(/\s+/);
    if (parts.length < 3) throw new Error(`Unreadable line in the LUT: "${line.slice(0, 40)}"`);
    values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }

  if (!Number.isInteger(size) || size < 2 || size > 256) {
    throw new Error("The file has no valid LUT_3D_SIZE, so it is not a 3D .cube LUT.");
  }
  const expected = size * size * size;
  if (values.length !== expected * 3) {
    throw new Error(`A ${size}-point LUT needs ${expected} colour rows; this file has ${Math.floor(values.length / 3)}.`);
  }
  if (values.some((v) => !Number.isFinite(v))) throw new Error("The LUT contains values that are not numbers.");
  const domainOk = [domainMin, domainMax].every((d) => d.length === 3 && d.every(Number.isFinite)) &&
    domainMin.every((lo, i) => domainMax[i] > lo);
  if (!domainOk) throw new Error("The LUT's DOMAIN_MIN / DOMAIN_MAX are invalid.");

  return { title, size, domainMin, domainMax, data: Float32Array.from(values) };
}

function sampleTrilinear(data, size, x, y, z, channel) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const x1 = Math.min(x0 + 1, size - 1), y1 = Math.min(y0 + 1, size - 1), z1 = Math.min(z0 + 1, size - 1);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const at = (r, g, b) => data[(r + g * size + b * size * size) * 3 + channel];
  const c00 = at(x0, y0, z0) + (at(x1, y0, z0) - at(x0, y0, z0)) * fx;
  const c10 = at(x0, y1, z0) + (at(x1, y1, z0) - at(x0, y1, z0)) * fx;
  const c01 = at(x0, y0, z1) + (at(x1, y0, z1) - at(x0, y0, z1)) * fx;
  const c11 = at(x0, y1, z1) + (at(x1, y1, z1) - at(x0, y1, z1)) * fx;
  const c0 = c00 + (c10 - c00) * fy;
  const c1 = c01 + (c11 - c01) * fy;
  return c0 + (c1 - c0) * fz;
}

/**
 * Resample a parsed LUT onto a size-point grid over input 0..1 with 8-bit outputs,
 * honouring the file's input domain. This is the form that is stored and applied.
 */
export function bakeLut(parsed, targetSize = Math.min(parsed.size, MAX_LUT_SIZE)) {
  const n = Math.max(2, Math.min(MAX_LUT_SIZE, Math.round(targetSize)));
  const out = new Uint8Array(n * n * n * 3);
  const { size, data, domainMin, domainMax } = parsed;
  const toLut = (value, axis) => {
    const t = (value - domainMin[axis]) / (domainMax[axis] - domainMin[axis]);
    return Math.min(size - 1, Math.max(0, t * (size - 1)));
  };

  let o = 0;
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const x = toLut(r / (n - 1), 0);
        const y = toLut(g / (n - 1), 1);
        const z = toLut(b / (n - 1), 2);
        for (let c = 0; c < 3; c++) {
          const v = sampleTrilinear(data, size, x, y, z, c);
          out[o++] = Math.round(Math.min(1, Math.max(0, v)) * 255);
        }
      }
    }
  }
  return { size: n, data: out };
}

/* ---------------------------- storage encoding ----------------------------- */

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeLut(baked) {
  return { size: baked.size, data: bytesToBase64(baked.data) };
}

const decodedLuts = new Map();

/** Decode a stored LUT, or null when it is malformed. Cached, so previews stay cheap. */
export function decodeLut(stored) {
  const size = Number(stored?.size);
  const b64 = stored?.data;
  if (!Number.isInteger(size) || size < 2 || size > MAX_LUT_SIZE || typeof b64 !== "string") return null;
  const key = `${size}:${b64.length}:${b64.slice(0, 48)}:${b64.slice(-48)}`;
  if (decodedLuts.has(key)) return decodedLuts.get(key);
  let data;
  try {
    data = base64ToBytes(b64);
  } catch {
    return null;
  }
  if (data.length !== size * size * size * 3) return null;
  const lut = { size, data };
  if (decodedLuts.size > 24) decodedLuts.clear();
  decodedLuts.set(key, lut);
  return lut;
}

/* -------------------------------- applying --------------------------------- */

/**
 * Apply a decoded LUT in place to RGBA pixels (ImageData.data). strength 0..1
 * blends with the original, like a LUT layer's opacity.
 */
export function applyLutToPixels(pixels, lut, strength = 1) {
  const n = lut.size;
  const d = lut.data;
  const nn = n * n;
  const amount = clamp(strength, 0, 1, 1);
  if (amount === 0) return pixels;

  const lo = new Uint16Array(256);
  const hi = new Uint16Array(256);
  const frac = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    const pos = (v / 255) * (n - 1);
    lo[v] = Math.floor(pos);
    hi[v] = Math.min(lo[v] + 1, n - 1);
    frac[v] = pos - lo[v];
  }

  for (let p = 0; p < pixels.length; p += 4) {
    const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2];
    const r0 = lo[r], r1 = hi[r], fr = frac[r];
    const g0 = lo[g] * n, g1 = hi[g] * n, fg = frac[g];
    const b0 = lo[b] * nn, b1 = hi[b] * nn, fb = frac[b];

    const i000 = (r0 + g0 + b0) * 3, i100 = (r1 + g0 + b0) * 3;
    const i010 = (r0 + g1 + b0) * 3, i110 = (r1 + g1 + b0) * 3;
    const i001 = (r0 + g0 + b1) * 3, i101 = (r1 + g0 + b1) * 3;
    const i011 = (r0 + g1 + b1) * 3, i111 = (r1 + g1 + b1) * 3;

    for (let c = 0; c < 3; c++) {
      const c00 = d[i000 + c] + (d[i100 + c] - d[i000 + c]) * fr;
      const c10 = d[i010 + c] + (d[i110 + c] - d[i010 + c]) * fr;
      const c01 = d[i001 + c] + (d[i101 + c] - d[i001 + c]) * fr;
      const c11 = d[i011 + c] + (d[i111 + c] - d[i011 + c]) * fr;
      const c0 = c00 + (c10 - c00) * fg;
      const c1 = c01 + (c11 - c01) * fg;
      const mapped = c0 + (c1 - c0) * fb;
      const original = pixels[p + c];
      pixels[p + c] = amount === 1 ? mapped : original + (mapped - original) * amount;
    }
  }
  return pixels;
}

/* --------------------------- tones on an event ----------------------------- */

/**
 * The definition an applied custom tone carries on the event. Presets carry
 * none; the booth knows them by effect id.
 */
export function toneToCustomSpec(tone) {
  if (!tone) return null;
  if (tone.kind === "lut" && tone.lut?.data) {
    return { kind: "lut", lut: { size: tone.lut.size, data: tone.lut.data }, strength: clamp(tone.strength, 0, 1, 1) };
  }
  if (tone.kind === "adjust") {
    return { kind: "adjust", adjustments: normalizeAdjustments(tone.adjustments) };
  }
  return null;
}

/** What the booth applies for a custom spec: a CSS filter, a LUT, or both. */
export function resolveCustomSpec(spec) {
  if (spec?.kind === "lut") {
    const lut = decodeLut(spec.lut);
    return lut ? { css: "none", lut, strength: clamp(spec.strength, 0, 1, 1) } : null;
  }
  if (spec?.kind === "adjust") {
    return { css: adjustmentsToCss(spec.adjustments), lut: null, strength: 1 };
  }
  return null;
}

/** Browser only: a JPEG data URL of src with a LUT applied, at most maxDim pixels on its long side. */
export async function renderLutPreview(src, lut, strength = 1, maxDim = 900) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = src;
  });
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyLutToPixels(imageData.data, lut, strength);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.88);
}
