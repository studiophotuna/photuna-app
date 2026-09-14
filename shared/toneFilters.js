// shared/toneFilters.js
//
// A booth tone (filter) as an FFmpeg filter graph, so a guest's per-pose clips
// and motion clip carry the same tone as their print.
//
// The print is toned in the renderer (FrameFilterScreen's applyTone, then the
// LUT from src/utils/toneSpec.js). This follows the same order: grayscale,
// sepia, hue and saturation, brightness, contrast, then the LUT blended at its
// strength. Brightness multiplies and contrast pivots on mid-grey, exactly as
// the print does; hue and saturation go through FFmpeg's hue filter, a close
// match to the print's HSL maths rather than an identical one.
//
// Tone values arrive from the renderer, so nothing from the request reaches the
// filter graph as text: the CSS-like string is parsed into clamped numbers and
// rebuilt, and a LUT is decoded, size-checked and written as a .cube file.
//
// CommonJS on purpose: required by Electron main and plain Node, like
// shared/motionComposite.js.

const MAX_LUT_SIZE = 33;

function clamp(value, min, max, fallback) {
  // Number(null) is 0, which would turn "not set" into "no brightness".
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function fmt(n) {
  return String(Number(Number(n).toFixed(4)));
}

/** The tone string the booth uses ("grayscale(1) contrast(1.15)") as clamped numbers. */
function parseToneCss(css) {
  const text = typeof css === "string" ? css : "";
  const read = (name, unit = "") => {
    const match = text.match(new RegExp(`${name}\\(\\s*(-?[0-9.]+)\\s*${unit}\\s*\\)`));
    return match ? Number(match[1]) : null;
  };
  return {
    grayscale: (read("grayscale") ?? 0) >= 0.5,
    sepia: clamp(read("sepia"), 0, 1, 0),
    hue: clamp(read("hue-rotate", "deg"), -180, 180, 0),
    saturate: clamp(read("saturate"), 0, 3, 1),
    brightness: clamp(read("brightness"), 0, 3, 1),
    contrast: clamp(read("contrast"), 0, 3, 1),
  };
}

function isNeutral(adj) {
  return !adj.grayscale && adj.sepia === 0 && adj.hue === 0 &&
    adj.saturate === 1 && adj.brightness === 1 && adj.contrast === 1;
}

function mixer(m) {
  const [[rr, rg, rb], [gr, gg, gb], [br, bg, bb]] = m;
  return `colorchannelmixer=rr=${fmt(rr)}:rg=${fmt(rg)}:rb=${fmt(rb)}:gr=${fmt(gr)}:gg=${fmt(gg)}:gb=${fmt(gb)}:br=${fmt(br)}:bg=${fmt(bg)}:bb=${fmt(bb)}`;
}

function adjustmentFilters(adj) {
  const filters = [];
  if (adj.grayscale) {
    const l = [0.299, 0.587, 0.114];
    filters.push(mixer([l, l, l]));
  }
  if (adj.sepia > 0) {
    const a = adj.sepia;
    const sepia = [[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]];
    filters.push(mixer(sepia.map((row, r) => row.map((v, c) => (r === c ? 1 - a : 0) + v * a))));
  }
  if (adj.hue !== 0 || adj.saturate !== 1) {
    filters.push(`hue=h=${fmt(adj.hue)}:s=${fmt(adj.saturate)}`);
  }
  if (adj.brightness !== 1) {
    const b = adj.brightness;
    filters.push(`colorchannelmixer=rr=${fmt(b)}:gg=${fmt(b)}:bb=${fmt(b)}`);
  }
  if (adj.contrast !== 1) {
    const expr = `(val-128)*${fmt(adj.contrast)}+128`;
    filters.push(`lutrgb=r=${expr}:g=${expr}:b=${expr}`);
  }
  return filters;
}

/** A stored LUT ({ size, data: base64 }) as { size, data: Uint8Array }, or null. */
function decodeStoredLut(stored) {
  const size = Number(stored?.size);
  if (!Number.isInteger(size) || size < 2 || size > MAX_LUT_SIZE || typeof stored?.data !== "string") return null;
  const data = new Uint8Array(Buffer.from(stored.data, "base64"));
  return data.length === size * size * size * 3 ? { size, data } : null;
}

/** A decoded LUT as .cube text for FFmpeg's lut3d (red varies fastest, as stored). */
function lutToCubeText(lut) {
  const lines = ['TITLE "Photuna tone"', `LUT_3D_SIZE ${lut.size}`];
  for (let i = 0; i < lut.data.length; i += 3) {
    lines.push(`${(lut.data[i] / 255).toFixed(6)} ${(lut.data[i + 1] / 255).toFixed(6)} ${(lut.data[i + 2] / 255).toFixed(6)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Validate a tone from the renderer: { css, lut: { size, data }, strength }.
 * Returns null when it would change nothing.
 */
function sanitizeToneSpec(spec) {
  if (!spec || typeof spec !== "object") return null;
  const adjustments = parseToneCss(spec.css);
  const strength = clamp(spec.strength, 0, 1, 1);
  const lut = spec.lut ? decodeStoredLut(spec.lut) : null;
  const hasLut = Boolean(lut) && strength > 0;
  if (isNeutral(adjustments) && !hasLut) return null;
  return { adjustments, lut: hasLut ? lut : null, strength };
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Short stable id for a sanitized tone, for naming cached files. */
function toneKey(tone) {
  const lutPart = tone.lut ? Buffer.from(tone.lut.data).toString("base64") : "";
  return fnv1a(`${JSON.stringify(tone.adjustments)}|${tone.strength}|${lutPart}`);
}

// A path in a filter graph is unescaped twice: once by the graph parser, then by
// the filter's option parser. Quoting covers the first (and keeps spaces); the
// drive colon still needs '\:' for the second. A quote inside the path closes
// the quoting, adds a doubly escaped quote, and reopens it.
function escapeFilterPath(p) {
  const forOptions = String(p).replace(/\\/g, "/").replace(/:/g, "\\:");
  return `'${forOptions.replace(/'/g, "'\\\\\\''")}'`;
}

/**
 * Filter lines that take inLabel to outLabel with the tone applied, or [] when
 * the tone changes nothing. lutFile is the tone's LUT already written to disk.
 */
function buildToneGraph({ inLabel, outLabel, tone, lutFile = null }) {
  if (!tone) return [];
  const adjust = adjustmentFilters(tone.adjustments);
  const useLut = Boolean(tone.lut && lutFile) && tone.strength > 0;
  if (!adjust.length && !useLut) return [];

  // gbrp at the end, so split, lut3d and blend all agree on the pixel format.
  const pre = [...adjust, "format=gbrp"].join(",");
  if (!useLut) return [`${inLabel}${pre}${outLabel}`];

  const lut3d = `lut3d=file=${escapeFilterPath(lutFile)}:interp=trilinear`;
  if (tone.strength >= 1) return [`${inLabel}${pre},${lut3d}${outLabel}`];

  const id = outLabel.replace(/\W/g, "") || "tone";
  return [
    `${inLabel}${pre},split=2[${id}_orig][${id}_src]`,
    `[${id}_src]${lut3d}[${id}_lut]`,
    `[${id}_orig][${id}_lut]blend=all_expr=A*${fmt(1 - tone.strength)}+B*${fmt(tone.strength)}${outLabel}`,
  ];
}

module.exports = {
  MAX_LUT_SIZE,
  parseToneCss,
  sanitizeToneSpec,
  decodeStoredLut,
  lutToCubeText,
  toneKey,
  buildToneGraph,
  escapeFilterPath,
};
