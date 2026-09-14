// Tests the tone maths in src/utils/toneSpec.js: .cube parsing, LUT baking,
// storage encoding, and applying a LUT to pixels.
//
//   node scripts/test-tone-spec.mjs
//
// The module is ES-module source inside src/, so it is copied to a temp .mjs
// file and imported from there.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, "..", "src", "utils", "toneSpec.js");
const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tone-spec-")), "toneSpec.mjs");
fs.copyFileSync(source, copy);
const {
  parseCubeLut, bakeLut, encodeLut, decodeLut, applyLutToPixels,
  adjustmentsToCss, toneToCustomSpec, resolveCustomSpec, MAX_LUT_SIZE,
} = await import(pathToFileURL(copy).href);

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (err) { results.push({ name, ok: false, error: err.message }); }
}

// A .cube whose output is f(r, g, b), red varying fastest as the format requires.
function cube(size, f, header = "") {
  const lines = [`TITLE "test"`, `LUT_3D_SIZE ${size}`, header];
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [or, og, ob] = f(r / (size - 1), g / (size - 1), b / (size - 1));
        lines.push(`${or.toFixed(6)} ${og.toFixed(6)} ${ob.toFixed(6)}`);
      }
    }
  }
  return lines.join("\n");
}

const identity = (r, g, b) => [r, g, b];
const invert = (r, g, b) => [1 - r, 1 - g, 1 - b];

function samplePixels() {
  const px = [];
  for (const v of [0, 17, 64, 128, 200, 255]) px.push(v, 255 - v, (v * 7) % 256, 255);
  return new Uint8ClampedArray(px);
}

function maxDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) d = Math.max(d, Math.abs(a[i] - b[i]));
  return d;
}

const bakedFrom = (text) => decodeLut(encodeLut(bakeLut(parseCubeLut(text))));

check("an identity LUT leaves photos unchanged", () => {
  const lut = bakedFrom(cube(17, identity));
  const before = samplePixels();
  const after = applyLutToPixels(samplePixels(), lut);
  assert.ok(maxDiff(before, after) <= 1, `differs by ${maxDiff(before, after)}`);
});

check("an inverting LUT inverts colours", () => {
  const lut = bakedFrom(cube(9, invert));
  const before = samplePixels();
  const after = applyLutToPixels(samplePixels(), lut);
  for (let i = 0; i < before.length; i++) {
    if (i % 4 === 3) continue;
    assert.ok(Math.abs(after[i] - (255 - before[i])) <= 1, `channel ${i}: ${after[i]} vs ${255 - before[i]}`);
  }
});

check("red varies fastest: a LUT that swaps red and blue is read the right way round", () => {
  const lut = bakedFrom(cube(5, (r, g, b) => [b, g, r]));
  const px = applyLutToPixels(new Uint8ClampedArray([255, 0, 0, 255]), lut);
  assert.deepEqual([...px], [0, 0, 255, 255]);
});

check(`a 65-point LUT is stored at ${MAX_LUT_SIZE} points and still matches`, () => {
  const text = cube(65, (r, g, b) => [r ** 0.8, g, b ** 1.2]);
  const baked = bakeLut(parseCubeLut(text));
  assert.equal(baked.size, MAX_LUT_SIZE);
  const lut = decodeLut(encodeLut(baked));
  const px = applyLutToPixels(new Uint8ClampedArray([128, 128, 128, 255]), lut);
  assert.ok(Math.abs(px[0] - Math.round((128 / 255) ** 0.8 * 255)) <= 2, `red ${px[0]}`);
  assert.ok(Math.abs(px[2] - Math.round((128 / 255) ** 1.2 * 255)) <= 2, `blue ${px[2]}`);
});

check("DOMAIN_MAX is honoured: input 1.0 reads the middle of a 0..2 LUT", () => {
  // Output equals the input coordinate, so mid-grid = 1.0 → white.
  const lut = bakedFrom(cube(3, (r, g, b) => [r, g, b].map((v) => Math.min(1, v * 2)), "DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2"));
  const px = applyLutToPixels(new Uint8ClampedArray([255, 128, 0, 255]), lut);
  assert.ok(px[0] >= 254, `red ${px[0]}`);
  assert.ok(Math.abs(px[1] - 128) <= 2, `green ${px[1]}`);
  assert.equal(px[2], 0);
});

check("strength 0.5 blends halfway between the photo and the LUT", () => {
  const lut = bakedFrom(cube(5, invert));
  const px = applyLutToPixels(new Uint8ClampedArray([200, 0, 100, 255]), lut, 0.5);
  assert.ok(Math.abs(px[0] - 128) <= 1 && Math.abs(px[1] - 128) <= 1 && Math.abs(px[2] - 128) <= 1, [...px].join(","));
});

check("comments, blank lines and unknown keywords are ignored", () => {
  const text = `# made by a grading tool\n\nLUT_3D_INPUT_RANGE 0 1\n${cube(2, identity)}\n# end`;
  assert.equal(parseCubeLut(text).size, 2);
});

check("a 1D LUT is refused with a message that says what to export", () => {
  assert.throws(() => parseCubeLut("LUT_1D_SIZE 1024\n0 0 0"), /3D LUT/);
});

check("a truncated file is refused with the row count", () => {
  const text = cube(4, identity).split("\n").slice(0, -5).join("\n");
  assert.throws(() => parseCubeLut(text), /needs 64 colour rows; this file has 59/);
});

check("a file with no size is refused", () => {
  assert.throws(() => parseCubeLut("0 0 0\n1 1 1"), /LUT_3D_SIZE/);
});

check("stored LUTs of the wrong length are rejected, not applied", () => {
  const stored = encodeLut(bakeLut(parseCubeLut(cube(5, identity))));
  assert.equal(decodeLut({ size: 6, data: stored.data }), null);
  assert.equal(decodeLut({ size: 5, data: "not base64 of the right length" }), null);
  assert.equal(decodeLut({ size: 999, data: stored.data }), null);
});

check("neutral slider adjustments produce no filter", () => {
  assert.equal(adjustmentsToCss({ brightness: 1, contrast: 1, saturation: 1, hue: 0, sepia: 0 }), "none");
});

check("saturation 0 renders black and white, and values are clamped to their limits", () => {
  assert.equal(adjustmentsToCss({ saturation: 0 }), "grayscale(1)");
  assert.equal(adjustmentsToCss({ brightness: 9, hue: -300 }), "hue-rotate(-45deg) brightness(1.5)");
});

check("an applied LUT tone carries everything the booth needs to render it", () => {
  const tone = { id: "lut-1", name: "Teal", kind: "lut", strength: 0.8, lut: encodeLut(bakeLut(parseCubeLut(cube(5, invert)))) };
  const resolved = resolveCustomSpec(toneToCustomSpec(tone));
  assert.equal(resolved.css, "none");
  assert.equal(resolved.strength, 0.8);
  assert.equal(resolved.lut.size, 5);
});

check("an applied slider tone resolves to a CSS filter", () => {
  const resolved = resolveCustomSpec(toneToCustomSpec({ kind: "adjust", adjustments: { contrast: 1.2, saturation: 1.3 } }));
  assert.equal(resolved.css, "saturate(1.3) contrast(1.2)");
  assert.equal(resolved.lut, null);
});

check("a corrupt applied tone resolves to nothing instead of throwing", () => {
  assert.equal(resolveCustomSpec({ kind: "lut", lut: { size: 5, data: "AAAA" } }), null);
  assert.equal(resolveCustomSpec(null), null);
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.error}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
