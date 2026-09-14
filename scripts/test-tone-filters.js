// Checks shared/toneFilters.js against the real FFmpeg the booth ships: a solid
// colour goes through each tone and the output pixel must match what the print
// pipeline produces for the same colour.
//
//   node scripts/test-tone-filters.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const {
  sanitizeToneSpec, buildToneGraph, lutToCubeText, decodeStoredLut, toneKey, parseToneCss,
} = require("../shared/toneFilters");

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

// A folder with spaces, like "Photuna Booth App" under AppData, and a quote,
// like a Windows account named O'Brien.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tone filter's test "));

// Source colour R=200 G=100 B=50.
const SOURCE = [200, 100, 50];

function storedLut(size, f) {
  const data = new Uint8Array(size * size * size * 3);
  let o = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = f(r / (size - 1), g / (size - 1), b / (size - 1));
        for (const v of out) data[o++] = Math.round(v * 255);
      }
    }
  }
  return { size, data: Buffer.from(data).toString("base64") };
}

function renderPixel(spec) {
  const tone = sanitizeToneSpec(spec);
  let lutFile = null;
  if (tone?.lut) {
    lutFile = path.join(workDir, `tone-${toneKey(tone)}.cube`);
    fs.writeFileSync(lutFile, lutToCubeText(tone.lut));
  }
  const graph = buildToneGraph({ inLabel: "[0:v]", outLabel: "[out]", tone, lutFile });
  const filter = graph.length ? graph.join(";") : "[0:v]null[out]";
  const hex = SOURCE.map((v) => v.toString(16).padStart(2, "0")).join("");
  const res = spawnSync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=0x${hex}:s=16x16:d=1,format=rgb24`,
    "-filter_complex", filter, "-map", "[out]",
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ], { maxBuffer: 1 << 20 });
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr.toString().trim()}`);
  const px = res.stdout;
  const center = (8 * 16 + 8) * 3;
  return [px[center], px[center + 1], px[center + 2]];
}

function near(actual, expected, tolerance = 4) {
  expected.forEach((v, i) => {
    assert.ok(Math.abs(actual[i] - v) <= tolerance, `got ${actual.join(",")}, expected ${expected.map((x) => x.toFixed(0)).join(",")}`);
  });
}

check("a neutral tone builds no filters, so untoned clips are left alone", () => {
  assert.strictEqual(sanitizeToneSpec({ css: "none" }), null);
  assert.strictEqual(sanitizeToneSpec({ css: "brightness(1) contrast(1)", lut: null }), null);
  assert.deepStrictEqual(buildToneGraph({ inLabel: "[0:v]", outLabel: "[o]", tone: null }), []);
});

check("black & white matches the print's luma weights", () => {
  const gray = 0.299 * SOURCE[0] + 0.587 * SOURCE[1] + 0.114 * SOURCE[2];
  near(renderPixel({ css: "grayscale(1)" }), [gray, gray, gray]);
});

check("sepia matches the print's sepia matrix", () => {
  const [r, g, b] = SOURCE;
  near(renderPixel({ css: "sepia(1)" }), [
    0.393 * r + 0.769 * g + 0.189 * b,
    0.349 * r + 0.686 * g + 0.168 * b,
    0.272 * r + 0.534 * g + 0.131 * b,
  ]);
});

check("brightness multiplies, as on the print", () => {
  near(renderPixel({ css: "brightness(1.1)" }), SOURCE.map((v) => v * 1.1));
});

check("contrast pivots on mid-grey, as on the print", () => {
  near(renderPixel({ css: "contrast(1.5)" }), SOURCE.map((v) => Math.min(255, Math.max(0, (v - 128) * 1.5 + 128))));
});

check("a LUT is applied from a folder whose path has spaces and a drive colon", () => {
  near(renderPixel({ css: "none", lut: storedLut(9, (r, g, b) => [1 - r, 1 - g, 1 - b]), strength: 1 }), SOURCE.map((v) => 255 - v));
});

check("a LUT at 50% strength blends halfway", () => {
  near(renderPixel({ css: "none", lut: storedLut(9, (r, g, b) => [1 - r, 1 - g, 1 - b]), strength: 0.5 }), [128, 128, 128]);
});

check("a LUT at 0% strength with no adjustments is neutral", () => {
  assert.strictEqual(sanitizeToneSpec({ css: "none", lut: storedLut(5, (r, g, b) => [r, g, b]), strength: 0 }), null);
});

check("adjustments and a LUT combine in the print's order", () => {
  const gray = 0.299 * SOURCE[0] + 0.587 * SOURCE[1] + 0.114 * SOURCE[2];
  near(renderPixel({ css: "grayscale(1)", lut: storedLut(9, (r, g, b) => [1 - r, 1 - g, 1 - b]), strength: 1 }), [255 - gray, 255 - gray, 255 - gray]);
});

check("a corrupt or oversized LUT is ignored rather than written", () => {
  assert.strictEqual(decodeStoredLut({ size: 9, data: "AAAA" }), null);
  assert.strictEqual(decodeStoredLut({ size: 65, data: storedLut(2, (r, g, b) => [r, g, b]).data }), null);
  assert.strictEqual(sanitizeToneSpec({ css: "none", lut: { size: 9, data: "AAAA" } }), null);
});

check("text in the tone string never reaches the filter graph", () => {
  const tone = sanitizeToneSpec({ css: "brightness(1.2):drawtext=text='x' contrast(1.1)[x];movie=/etc/passwd" });
  const graph = buildToneGraph({ inLabel: "[0:v]", outLabel: "[o]", tone }).join(";");
  assert.ok(!/drawtext|movie|passwd/.test(graph), graph);
  assert.deepStrictEqual(parseToneCss("brightness(99)").brightness, 3);
});

check("the same tone always gets the same cache key, and a different one does not", () => {
  const a = sanitizeToneSpec({ css: "contrast(1.2)" });
  assert.strictEqual(toneKey(a), toneKey(sanitizeToneSpec({ css: "contrast(1.2)" })));
  assert.notStrictEqual(toneKey(a), toneKey(sanitizeToneSpec({ css: "contrast(1.3)" })));
});

check("a whole clip encodes with a tone applied", () => {
  const input = path.join(workDir, "slot0.mp4");
  let res = spawnSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=320x240:d=1:r=30",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", input]);
  assert.strictEqual(res.status, 0, res.stderr?.toString());
  const tone = sanitizeToneSpec({ css: "saturate(1.3) hue-rotate(15deg)", lut: storedLut(5, (r, g, b) => [r, g * 0.9, b]), strength: 0.7 });
  const lutFile = path.join(workDir, `tone-${toneKey(tone)}.cube`);
  fs.writeFileSync(lutFile, lutToCubeText(tone.lut));
  const output = path.join(workDir, "slot0_toned.mp4");
  res = spawnSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", input,
    "-filter_complex", buildToneGraph({ inLabel: "[0:v]", outLabel: "[toned]", tone, lutFile }).join(";"),
    "-map", "[toned]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", output]);
  assert.strictEqual(res.status, 0, res.stderr?.toString());
  assert.ok(fs.statSync(output).size > 1000);
});

fs.rmSync(workDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.error}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
