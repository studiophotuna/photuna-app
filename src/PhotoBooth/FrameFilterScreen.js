// src/components/FrameFilterScreen.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { drawTrialWatermark } from "../utils/watermark";
import { motion } from "framer-motion";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";
import { DEFAULT_APPEARANCE } from "../utils/appearance";
import { useLayout } from "../utils/useLayout";

/* ---------------------------- Helpers ---------------------------- */
function formatMoney(amount = 0, currency = "PHP") {
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
}

/* ---------------------------- Tone & Frames ---------------------------- */
const TONE_FILTERS = {
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



/* ---- i18n labels (minimal) ---- */
const LOCALES = {
  en: {
    tone: "Tone",
    frame: "Frame",
    quantityTitle: "Print quantity",
    quantityHint: "First print is already paid. Extra copies require additional payment.",
    perCopy: "Per copy",
    extraCopies: "Extra copies",
    addlFee: "Additional fee",
    invoice: "Invoice",
    invoiceHint: "First print is already paid. Pay only for extra copies.",
    paymentMethod: "Payment method",
    cancel: "Cancel",
    payAndContinue: "Pay & Print →",
    continue: "Print →",
    preparing: "Preparing...",
    empty: "Empty",
  },
  tl: {
    tone: "Tono",
    frame: "Frame",
    quantityTitle: "Dami ng prints",
    quantityHint: "Bayad na ang unang print. Kailangan ng bayad sa karagdagang kopya.",
    perCopy: "Bawat kopya",
    extraCopies: "Dagdag na kopya",
    addlFee: "Karagdagang bayad",
    invoice: "Resibo",
    invoiceHint: "Bayad na ang unang print. Magbayad lang para sa dagdag na kopya.",
    paymentMethod: "Paraan ng bayad",
    cancel: "Kanselahin",
    payAndContinue: "Magbayad at Magpatuloy →",
    continue: "Magpatuloy →",
    preparing: "Inehanda...",
    empty: "Wala",
  },
};

function resolveLocale(code) {
  const key = String(code || "en").toLowerCase();
  return LOCALES[key] || LOCALES.en;
}

const TONEEFFECTS = [
  { id: "normal",  label: { en: "Normal",       tl: "Normal" } },
  { id: "vivid",   label: { en: "Vivid",         tl: "Maliwanag" } },
  { id: "soft",    label: { en: "Soft",           tl: "Malambot" } },
  { id: "dreamy",  label: { en: "Dreamy",         tl: "Panaginip" } },
  { id: "warm",    label: { en: "Warm",           tl: "Mainit" } },
  { id: "cool",    label: { en: "Cool",           tl: "Malamig" } },
  { id: "vintage", label: { en: "Vintage",        tl: "Vintage" } },
  { id: "film",    label: { en: "Film",           tl: "Film" } },
  { id: "sepia",   label: { en: "Sepia",          tl: "Sepia" } },
  { id: "bw",      label: { en: "Black & White",  tl: "Itim at Puti" } },
  { id: "drama",   label: { en: "Drama",          tl: "Drama" } },
  { id: "party",   label: { en: "Party Pop",      tl: "Pista" } },
];

const FRAMES = [
  { id: "white", label: { en: "White", tl: "Puti" }, color: "#ffffff", border: "#000000", borderWidth: 2, padding: 12 },
  { id: "black", label: { en: "Black", tl: "Itim" }, color: "#000000", border: "#ffffff", borderWidth: 2, padding: 12 },
  { id: "pink", label: { en: "Pink", tl: "Rosas" }, color: "#ffb6c1", border: "#2b2b2b", borderWidth: 2, padding: 12 },
  { id: "purple", label: { en: "Purple", tl: "Lila" }, color: "#c3a6ff", border: "#2b2b2b", borderWidth: 2, padding: 12 },
  { id: "pastel-pink", label: { en: "Pastel Pink", tl: "Pastel Rosas" }, color: "#ffd6e7", border: "#2b2b2b", borderWidth: 2, padding: 12 },
  { id: "pastel-blue", label: { en: "Pastel Blue", tl: "Pastel Asul" }, color: "#d6f0ff", border: "#2b2b2b", borderWidth: 2, padding: 12 },
  { id: "pastel-green", label: { en: "Pastel Green", tl: "Pastel Berde" }, color: "#d6ffd6", border: "#2b2b2b", borderWidth: 2, padding: 12 },
  { id: "gold", label: { en: "Gold", tl: "Ginto" }, color: "#fff1c6", border: "#bfa14a", borderWidth: 4, padding: 12 },
  { id: "silver", label: { en: "Silver", tl: "Pilak" }, color: "#f0f0f0", border: "#a3a3a3", borderWidth: 4, padding: 12 },
  { id: "bronze", label: { en: "Bronze", tl: "Bronse" }, color: "#f5e1d1", border: "#b36b3c", borderWidth: 4, padding: 12 },
];

const resolvedWidth = 1200;
const resolvedHeight = 1800;

const GATEWAY_SUPPORTED_CURRENCIES = {
  paymongo: ["PHP"],
  xendit:   ["IDR", "PHP", "SGD", "USD", "MYR", "VND"],
  stripe:   ["USD", "EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "SGD", "MYR", "THB", "JPY", "KRW", "INR", "HKD", "TWD", "CNY", "AUD", "CAD", "NZD"],
  paypal:   ["USD", "EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "HUF", "CZK", "MYR", "PHP", "SGD", "THB", "TWD", "JPY", "AUD", "CAD", "NZD", "HKD"],
};

// Same mapping you use in AdminDashboard
function mapFrameNameToStyleId(name = "") {
  const k = String(name || "").trim().toLowerCase();
  if (k === "white") return "white";
  if (k === "black") return "black";
  if (k === "gold") return "gold";
  if (k === "silver") return "silver";
  if (k === "bronze") return "bronze";
  if (k === "pink") return "pink";
  if (k === "purple") return "purple";
  if (k === "pastel pink") return "pastel-pink";
  if (k === "pastel blue") return "pastel-blue";
  if (k === "pastel green") return "pastel-green";
  return null;
}

function mapToneToEffectId(tone) {
  switch (tone?.id) {
    case "pb-blackwhite": return "bw";
    case "pb-vintage":    return "vintage";
    case "pb-warm":       return "warm";
    case "pb-cool":       return "cool";
    case "pb-bright":
    case "pb-vivid":      return "vivid";
    case "pb-party":      return "party";
    case "pb-soft":       return "soft";
    case "pb-dreamy":     return "dreamy";
    case "pb-drama":      return "drama";
    case "pb-film":       return "film";
    case "pb-sepia":      return "sepia";
    case "pb-normal":     return "normal";
  }
  const k = String(tone?.name || "").trim().toLowerCase();
  if (k.includes("black") && k.includes("white")) return "bw";
  if (k.includes("vintage"))  return "vintage";
  if (k.includes("warm"))     return "warm";
  if (k.includes("cool"))     return "cool";
  if (k.includes("sepia"))    return "sepia";
  if (k.includes("vivid") || k.includes("bright")) return "vivid";
  if (k.includes("party"))    return "party";
  if (k.includes("soft"))     return "soft";
  if (k.includes("dreamy"))   return "dreamy";
  if (k.includes("drama"))    return "drama";
  if (k.includes("film"))     return "film";
  return null;
}

// Build safe Sets from snapshots (prefer canonical ids; fallback to name mapping)
function toAppliedFrameStyleSet(ev) {
  const list = Array.isArray(ev?.appliedFrames) ? ev.appliedFrames : [];
  const ids = list
    .map(f => f?.styleId || mapFrameNameToStyleId(f?.name))
    .filter(Boolean);
  return new Set(ids);
}

function toAppliedToneEffectSet(ev) {
  const list = Array.isArray(ev?.appliedTones) ? ev.appliedTones : [];
  const ids = list
    .map(t => t?.effectId || mapToneToEffectId(t))
    .filter(Boolean);
  return new Set(ids);
}

async function composeBurstPrintImage({
  template,
  slots,
  width = 1200,
  height = 1800,
}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  for (let i = 0; i < template.slots.length; i++) {
    const slot = template.slots[i];
    const photo = slots?.[i];

    if (!slot || !photo?.photoUrl) continue;

    const img = await loadImage(photo.photoUrl);

    const x = slot.x * width;
    const y = slot.y * height;
    const w = slot.w * width;
    const h = slot.h * height;

    const burstCount = 3;
    const gap = 6;
    const miniHeight = (h - gap * (burstCount - 1)) / burstCount;

    for (let b = 0; b < burstCount; b++) {
      const offsetY = y + b * (miniHeight + gap);

      ctx.drawImage(
        img,
        0,
        0,
        img.width,
        img.height,
        x,
        offsetY,
        w,
        miniHeight
      );

      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, offsetY, w, miniHeight);
    }
  }

  return canvas.toDataURL("image/png");
}

/* ---------------------------- Compose Print Image ---------------------------- */

async function composePrintImage({
  layout = "4x6",
  dpi = 300,
  frame,
  tone,     // "normal" | "bw" | etc. (id used with TONE_FILTERS)
  slots,
  photos,
  watermark = false,
}) {
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Apply tone to an image on an offscreen canvas

  function applyTone(offCtx, w, h, toneFilter) {
    if (!toneFilter || toneFilter === "none") return;

    const imageData = offCtx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Parse supported filters from the CSS-like string
    const toBW = /\bgrayscale\(\s*1\s*\)/.test(toneFilter);

    const brightnessMatch = toneFilter.match(/brightness\(\s*([^)]+)\s*\)/);
    const brightnessFactor = brightnessMatch ? parseFloat(brightnessMatch[1]) : 1;

    const contrastMatch = toneFilter.match(/contrast\(\s*([^)]+)\s*\)/);
    const contrastFactor = contrastMatch ? parseFloat(contrastMatch[1]) : 1;

    const sepiaMatch = toneFilter.match(/sepia\(\s*([^)]+)\s*\)/);
    const sepiaAmount = sepiaMatch ? Math.min(Math.max(parseFloat(sepiaMatch[1]), 0), 1) : 0;

    const hueMatch = toneFilter.match(/hue-rotate\(\s*([^)]+)\s*deg\s*\)/);
    const hueRotateDeg = hueMatch ? parseFloat(hueMatch[1]) : 0;

    const satMatch = toneFilter.match(/saturate\(\s*([^)]+)\s*\)/);
    const saturateFactor = satMatch ? parseFloat(satMatch[1]) : 1;

    // Helpers: RGB <-> HSL
    function rgbToHsl(r, g, b) {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0, s = 0; const l = (max + min) / 2;

      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
      }
      return [h, s, l];
    }
    function hslToRgb(h, s, l) {
      let r, g, b;
      if (s === 0) {
        r = g = b = l; // achromatic
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
      }
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i + 1], b = data[i + 2];

      // Grayscale
      if (toBW) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = gray;
      }

      // Sepia (blend with amount)
      if (sepiaAmount > 0) {
        const sr = 0.393 * r + 0.769 * g + 0.189 * b;
        const sg = 0.349 * r + 0.686 * g + 0.168 * b;
        const sb = 0.272 * r + 0.534 * g + 0.131 * b;
        r = r * (1 - sepiaAmount) + sr * sepiaAmount;
        g = g * (1 - sepiaAmount) + sg * sepiaAmount;
        b = b * (1 - sepiaAmount) + sb * sepiaAmount;
      }

      // Hue-rotate + Saturate via HSL
      if (hueRotateDeg !== 0 || saturateFactor !== 1) {
        let [h, s, l] = rgbToHsl(r, g, b);
        if (hueRotateDeg !== 0) {
          h = (h + (hueRotateDeg / 360)) % 1;
          if (h < 0) h += 1;
        }
        if (saturateFactor !== 1) {
          s = Math.min(Math.max(s * saturateFactor, 0), 1);
        }
        [r, g, b] = hslToRgb(h, s, l);
      }

      // Brightness (applied before contrast, matching CSS filter order)
      if (brightnessFactor !== 1) {
        r *= brightnessFactor;
        g *= brightnessFactor;
        b *= brightnessFactor;
      }

      // Contrast
      if (contrastFactor !== 1) {
        r = 128 + (r - 128) * contrastFactor;
        g = 128 + (g - 128) * contrastFactor;
        b = 128 + (b - 128) * contrastFactor;
      }

      // Clamp
      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
    }

    offCtx.putImageData(imageData, 0, 0);
  }

  function heightFitScale(containerH, imageH) {
    if (!containerH || !imageH) return 1;
    return containerH / imageH;
  }

  function clampOffsetsPx(offsetX, offsetY, imgW, imgH, boxW, boxH, finalScale) {
    const dispW = imgW * finalScale;
    const dispH = imgH * finalScale;

    const maxX = Math.max(0, (dispW - boxW) / 2);
    const maxY = Math.max(0, (dispH - boxH) / 2);

    return {
      x: Math.min(Math.max(offsetX, -maxX), maxX),
      y: Math.min(Math.max(offsetY, -maxY), maxY),
    };
  }

  const toneFilter = TONE_FILTERS[tone] || "none";

  // Sizes in pixels at given dpi
  const SHEET_4x6 = { w: 4 * dpi, h: 6 * dpi };  // 1200 x 1800
  const SHEET_6x4 = { w: 6 * dpi, h: 4 * dpi };  // 1800 x 1200
  const STRIP_2x6 = { w: 2 * dpi, h: 6 * dpi };  // 600  x 1800
  const STRIP_6x2 = { w: 6 * dpi, h: 2 * dpi };  // 1800 x 600

  // Render a single "print area" (frame + slots) to a canvas of given size
  async function renderFramedAreaToCanvas(areaW, areaH) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = areaW;
    canvas.height = areaH;

    // ✅ Detect overlay presence (from activeFrame.overlay) across all supported layouts
    const hasOverlay = !!(
      frame?.overlay?.["4x6"] ||
      frame?.overlay?.["2x6"] ||
      frame?.overlay?.["6x4"] ||
      frame?.overlay?.["6x2"]
    );

    // Background: prefer picked single color if provided; else respect Admin bg-color intent.
    // Never use a gradient here (single color only).
    const selected =
      frame?.pickedBgHex ||
      frame?.selectedColor ||
      (Array.isArray(frame?.bgHexes) ? frame.bgHexes[0] : null);

    const motionLikeBg =
      selected ||
      frame?.color ||
      "#ffffff";

    ctx.fillStyle = motionLikeBg;
    ctx.fillRect(0, 0, areaW, areaH);

    // Border only when not overlaying
    if ((frame.borderWidth || 0) > 0 && !hasOverlay) {
      ctx.strokeStyle = frame.border || "#000000";
      ctx.lineWidth = frame.borderWidth;
      ctx.strokeRect(0, 0, areaW, areaH);
    }

    // Inner padded area
    const pad = 0;
    const innerX = 0;
    const innerY = 0;
    const innerW = areaW;
    const innerH = areaH;

    for (const slot of slots || []) {
      // Clone slots share a photo with their source; use source's photo, slot's own position
      const photoSource = slot?.sourceSlotId
        ? ((slots || []).find(s => s.id === slot.sourceSlotId) ?? slot)
        : slot;

      const src =
        photoSource?.photoUrl ??
        (() => {
          const i = Number(photoSource?.photoIndex);
          return Number.isFinite(i) && i >= 0 && i < photos.length
            ? photos[i]
            : null;
        })();

      if (!src) continue;

      const img = await loadImage(src);

      // Slot rect in INNER area
      const sx = innerX + (slot.x ?? 0) * innerW;
      const sy = innerY + (slot.y ?? 0) * innerH;
      const sw = (slot.w ?? 0.25) * innerW;
      const sh = (slot.h ?? 0.25) * innerH;

      const rot = ((slot.rotation ?? 0) * Math.PI) / 180;
      const cx = sx + sw / 2;
      const cy = sy + sh / 2;

      // Match final-motion exactly:
      // 1) height-fit first
      // 2) apply user zoom
      // 3) place on working canvas with raw offsets (NO clamp)
      // 4) crop centered slot window
      // 5) rotate cropped slot tile and place on sheet
      const baseScale = sh / img.naturalHeight;
      const userScale = Math.max(1, Number(slot?.transform?.scale ?? 1));
      const finalScale = baseScale * userScale;

      const rawOffsetX = Number(slot?.transform?.offsetX ?? 0);
      const rawOffsetY = Number(slot?.transform?.offsetY ?? 0);

      const drawW = Math.round(img.naturalWidth * finalScale);
      const drawH = Math.round(img.naturalHeight * finalScale);

      // Build scaled/tone-applied source first
      const scaled = document.createElement("canvas");
      scaled.width = Math.max(1, drawW);
      scaled.height = Math.max(1, drawH);
      const sctx = scaled.getContext("2d");
      sctx.drawImage(img, 0, 0, scaled.width, scaled.height);
      applyTone(sctx, scaled.width, scaled.height, toneFilter);

      // Match ffmpeg pad=max(iw,w):max(ih,h)
      const padW = Math.max(drawW, Math.round(sw));
      const padH = Math.max(drawH, Math.round(sh));

      // Match ffmpeg pad x/y:
      const placeX = Math.max(0, (padW - drawW) / 2 + rawOffsetX);
      const placeY = Math.max(0, (padH - drawH) / 2 + rawOffsetY);

      const placed = document.createElement("canvas");
      placed.width = Math.max(1, Math.round(padW));
      placed.height = Math.max(1, Math.round(padH));
      const pctx = placed.getContext("2d");

      // transparent working canvas
      pctx.clearRect(0, 0, placed.width, placed.height);
      pctx.drawImage(scaled, placeX, placeY);

      // Match ffmpeg crop centered back to slot size
      const cropX = Math.max(0, (placed.width - sw) / 2);
      const cropY = Math.max(0, (placed.height - sh) / 2);

      const slotTile = document.createElement("canvas");
      slotTile.width = Math.max(1, Math.round(sw));
      slotTile.height = Math.max(1, Math.round(sh));
      const tctx = slotTile.getContext("2d");
      tctx.clearRect(0, 0, slotTile.width, slotTile.height);
      tctx.drawImage(
        placed,
        cropX, cropY, sw, sh,
        0, 0, sw, sh
      );

      // Now rotate the already-cropped slot tile, same stage order as motion
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.drawImage(slotTile, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }

    // ✅ TOP OVERLAY — draw after all slots, before returning canvas
    if (hasOverlay) {
      const layoutKey = String(layout).toLowerCase();
      const ovSrc =
        frame?.overlay?.[layoutKey] ||
        // sensible fallbacks when a specific overlay is missing
        (layoutKey === "2x6" ? frame?.overlay?.["4x6"] : null) ||
        (layoutKey === "6x2" ? frame?.overlay?.["6x4"] : null) ||
        frame?.overlay?.["4x6"] ||
        frame?.overlay?.["2x6"] ||
        frame?.overlay?.["6x4"] ||
        frame?.overlay?.["6x2"];

      if (ovSrc) {
        const ovImg = await loadImage(ovSrc);
        // Stretch to full area; switch to contain/cover math if desired
        ctx.drawImage(ovImg, 0, 0, areaW, areaH);
      }
    }

    if (watermark) {
      drawTrialWatermark(ctx, areaW, areaH);
    }

    return canvas;
  }


  const layoutKey = String(layout).toLowerCase();

  if (layoutKey === "2x6") {
    // Build one 2x6 strip and place two on a 4x6 sheet from top-left
    const stripCanvas = await renderFramedAreaToCanvas(STRIP_2x6.w, STRIP_2x6.h);

    const final = document.createElement("canvas");
    final.width = SHEET_4x6.w;
    final.height = SHEET_4x6.h;
    const fctx = final.getContext("2d");

    const sheetBg = frame?.pickedBgHex || frame?.selectedColor || frame?.color || "#ffffff";
    fctx.fillStyle = sheetBg;
    fctx.fillRect(0, 0, final.width, final.height);

    const leftX = 0;
    const rightX = STRIP_2x6.w;
    const topY = 0;

    fctx.drawImage(stripCanvas, leftX, topY);
    fctx.drawImage(stripCanvas, rightX, topY);

    fctx.strokeStyle = "rgba(0,0,0,0.15)";
    fctx.lineWidth = 2;
    const midX = STRIP_2x6.w;
    fctx.beginPath();
    fctx.moveTo(midX, 0);
    fctx.lineTo(midX, STRIP_2x6.h);
    fctx.stroke();

    if (watermark) {
      drawTrialWatermark(fctx, final.width, final.height);
    }

    return final.toDataURL("image/png");
  }

  if (layoutKey === "6x2") {
    // Build one 6x2 strip and place two on a 6x4 sheet from top-left
    const stripCanvas = await renderFramedAreaToCanvas(STRIP_6x2.w, STRIP_6x2.h);

    const final = document.createElement("canvas");
    final.width = SHEET_6x4.w;
    final.height = SHEET_6x4.h;
    const fctx = final.getContext("2d");

    const sheetBg = frame?.pickedBgHex || frame?.selectedColor || frame?.color || "#ffffff";
    fctx.fillStyle = sheetBg;
    fctx.fillRect(0, 0, final.width, final.height);

    const leftX = 0;
    const topY = 0;
    const bottomY = STRIP_6x2.h;

    fctx.drawImage(stripCanvas, leftX, topY);
    fctx.drawImage(stripCanvas, leftX, bottomY);

    fctx.strokeStyle = "rgba(0,0,0,0.15)";
    fctx.lineWidth = 2;
    const midY = STRIP_6x2.h;
    fctx.beginPath();
    fctx.moveTo(0, midY);
    fctx.lineTo(STRIP_6x2.w, midY);
    fctx.stroke();

    if (watermark) {
      drawTrialWatermark(fctx, final.width, final.height);
    }

    return final.toDataURL("image/png");
  }

  if (layoutKey === "6x4") {
    // Render a single 6x4 postcard
    const sheetCanvas = await renderFramedAreaToCanvas(SHEET_6x4.w, SHEET_6x4.h);
    return sheetCanvas.toDataURL("image/png");
  }

  // Default 4x6 postcard
  const sheetCanvas = await renderFramedAreaToCanvas(SHEET_4x6.w, SHEET_4x6.h);
  return sheetCanvas.toDataURL("image/png");
}

/* ---------------------------- Main Component ---------------------------- */
export default function FrameFilterScreen({
  eventId,
  sessionId = "default",
  countdownStart = 45,
  templateSelection,
  photos: photosProp,
  watermark = false,
  galleryEnabled = false,
  onNext,
  event = null,
}) {
  const api = typeof window !== "undefined" ? window.electron ?? window.api ?? null : null;
  const { isPortrait, isUnsupported, isPortrait2K, isTablet } = useLayout();

  const [timeLeft, setTimeLeft] = useState(countdownStart);
  // Event resolution
  const [currentEvent, setCurrentEvent] = useState(event ?? null);
  const [globalAppearance, setGlobalAppearance] = useState(null);
  const [globalSettings, setGlobalSettings] = useState(null);

  // Global frames (uploaded in Admin)
  const [allFrames, setAllFrames] = useState([]);
  const [framesLoading, setFramesLoading] = useState(true);
  const [framesLoadError, setFramesLoadError] = useState(false);

  const loadFrames = useCallback(async () => {
    if (!api?.getFrames) { setFramesLoading(false); return; }
    setFramesLoading(true);
    setFramesLoadError(false);
    try {
      const list = await api.getFrames();
      setAllFrames(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn("getFrames failed:", e);
      setFramesLoadError(true);
    } finally {
      setFramesLoading(false);
    }
  }, [api]);

  useEffect(() => { loadFrames(); }, [loadFrames]);

  // Robust normalizedLayout: allow 4x6, 2x6, 6x4, 6x2 
  const normalizedLayout = useMemo(() => {
    const raw =
      templateSelection?.previewMeta?.layout ??
      templateSelection?.layout ??
      "4x6";

    const key = String(raw).toLowerCase();
    return ["4x6", "2x6", "6x4", "6x2"].includes(key) ? key : "4x6";
  }, [templateSelection?.previewMeta?.layout, templateSelection?.layout]);

  // Fix initial template state: make slots safe
  const [template, setTemplate] = useState(() => ({
    id: templateSelection?.id ?? "",
    name: templateSelection?.name ?? "",
    slots: templateSelection?.slots ?? [],
    layout:
      templateSelection?.previewMeta?.layout ??
      templateSelection?.layout ??
      "4x6",
  }));

  const resolvedLayoutConfig = useMemo(() => {
    const rawSlots =
      (Array.isArray(template?.slots) && template.slots.length > 0
        ? template.slots
        : templateSelection?.slots) || [];

    const slotVideoMap = rawSlots.map((slot, finalIndex) => {
      // Clone slots inherit their source slot's photo index
      if (slot?.sourceSlotId) {
        const src = rawSlots.find(s => s.id === slot.sourceSlotId);
        if (src) {
          return Number.isInteger(src?.photoIndex) ? src.photoIndex :
            Number.isInteger(src?.sourceIndex) ? src.sourceIndex :
              Number.isInteger(src?.slotIndex) ? src.slotIndex :
                finalIndex;
        }
      }
      const mapped =
        Number.isInteger(slot?.photoIndex) ? slot.photoIndex :
          Number.isInteger(slot?.sourceIndex) ? slot.sourceIndex :
            Number.isInteger(slot?.slotIndex) ? slot.slotIndex :
              finalIndex;

      return mapped;
    });

    return {
      layoutKey: normalizedLayout,
      width: resolvedWidth,
      height: resolvedHeight,
      slots: rawSlots,
      slotVideoMap,
    };
  }, [normalizedLayout, templateSelection?.slots, template?.slots]);


  const templateAttachedIds = useMemo(() => {
    const ids = templateSelection?.previewMeta?.attachedFrameIds;
    return Array.isArray(ids) ? new Set(ids) : new Set();
  }, [templateSelection]);

  const templateActiveFrameId = templateSelection?.previewMeta?.activeFrameId ?? null;

  const framesForTemplate = useMemo(() => {
    if (!templateAttachedIds.size) return [];
    const layoutKey = normalizedLayout;

    // Build a quick lookup of per-event applied frame settings
    const eventAppliedMap = new Map(
      (currentEvent?.appliedFrames ?? []).map(af => [String(af.id), af])
    );

    return allFrames

      .filter(f => templateAttachedIds.has(f.id))
      .map(f => {

        const ev = eventAppliedMap.get(String(f.id)) ?? null;
        // Prefer per-event settings when present; fallback to global frame (rare)
        const useBgColor = !!(ev?.useBgColor && (
          (Array.isArray(ev?.palette?.colors) && ev.palette.colors.length > 0) ||
          !!ev?.selectedColor
        ));
        const palette = ev?.palette ?? f?.palette ?? null;
        const selectedColor = ev?.selectedColor ?? f?.selectedColor ?? null;
        const bgHexes = selectedColor
          ? [selectedColor]
          : (Array.isArray(palette?.colors) ? palette.colors.filter(Boolean) : []);

        return {
          id: f.id,
          kind: "custom-overlay",
          label: { en: f.name ?? "Frame", tl: f.name ?? "Frame" },
          styleId: null,
          overlay: {
            "4x6": f?.previews?.["4x6"]?.originalDataUrl ?? null,
            "2x6": f?.previews?.["2x6"]?.originalDataUrl ?? null,
            "6x4": f?.previews?.["6x4"]?.originalDataUrl ?? null,
            "6x2": f?.previews?.["6x2"]?.originalDataUrl ?? null
          },
          useBgColor,
          palette,
          selectedColor,
          bgHexes,
        };
      })

      .filter(entry => !!entry.overlay?.[layoutKey]);
  }, [allFrames, currentEvent, templateAttachedIds, normalizedLayout]);

  const customFramesToShow = useMemo(() => {
    const list = Array.isArray(currentEvent?.appliedFrames) ? currentEvent.appliedFrames : [];

    return list.map((af) => {
      const styleId = af?.styleId || mapFrameNameToStyleId(af?.name);

      const overlay4x6 = af?.previews?.["4x6"]?.originalDataUrl || null;
      const overlay2x6 = af?.previews?.["2x6"]?.originalDataUrl || null;
      const overlay6x4 = af?.previews?.["6x4"]?.originalDataUrl || null;
      const overlay6x2 = af?.previews?.["6x2"]?.originalDataUrl || null;

      const hasOverlay = !!(overlay4x6 || overlay2x6 || overlay6x4 || overlay6x2);

      const paletteHexes = af?.selectedColor
        ? [af.selectedColor]
        : Array.isArray(af?.palette?.colors)
          ? af.palette.colors.filter(Boolean)
          : [];

      return {
        id: hasOverlay ? `overlay-${af.id}` : (styleId ? styleId : `name-${af.id}`),
        kind: hasOverlay ? "custom-overlay" : (styleId ? "style" : "name-only"),
        label: { en: af?.name || "Frame", tl: af?.name || "Frame" },
        styleId,
        overlay: { "4x6": overlay4x6, "2x6": overlay2x6, "6x4": overlay6x4, "6x2": overlay6x2 },
        useBgColor: !!(af?.useBgColor && paletteHexes.length),
        palette: af?.palette ?? null,
        selectedColor: af?.selectedColor ?? null,
        bgHexes: paletteHexes,
      };
    });
  }, [currentEvent]);

  const saveComposedOutput = async (composedDataUrl) => {
    if (!api?.saveFinalPng) {
      return { ok: true, fileUrl: null, savedPath: null };
    }

    const result = await api.saveFinalPng({
      imageData: composedDataUrl,
      eventId,
      sessionId: sessionId || "default",
      filename: `final_composed_${Date.now()}.png`,
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Failed to save final output");
    }

    return result;
  };

  // And keep the useEffect as you had it (already safe)
  useEffect(() => {
    setTemplate(
      templateSelection
        ? {
          id: templateSelection.id ?? "",
          name: templateSelection.name ?? "",
          slots: templateSelection?.slots ?? [],
          layout:
            templateSelection?.previewMeta?.layout ??
            templateSelection?.layout ??
            "4x6",
        }
        : { id: "", slots: [], layout: "4x6" }
    );
  }, [templateSelection]);

  // IDs applied in AdminDashboard → Event
  const appliedFrameIds = useMemo(() => {
    return new Set(currentEvent?.appliedFrames?.map(f => f.id) ?? []);
  }, [currentEvent]);

  const appliedToneIds = useMemo(() => {
    return new Set(currentEvent?.appliedTones?.map(t => t.id) ?? []);
  }, [currentEvent]);

  // ---------- Allowed sets & filtered lists ----------
  const appliedFrameStyleIds = useMemo(
    () => toAppliedFrameStyleSet(currentEvent),
    [currentEvent]
  );
  const appliedToneEffectIds = useMemo(
    () => toAppliedToneEffectSet(currentEvent),
    [currentEvent]
  );

  const styleFramesSubset = useMemo(() => {
    if (!currentEvent) return FRAMES;
    if (appliedFrameStyleIds.size === 0) return FRAMES;
    const filtered = FRAMES.filter(f => appliedFrameStyleIds.has(f.id));
    return filtered.length ? filtered : FRAMES;
  }, [currentEvent, appliedFrameStyleIds]);

  const framesToShow = useMemo(() => {
    // Show ONLY frames attached to the selected template.
    // If none are attached, return [] and the UI will render a warning.
    return framesForTemplate;
  }, [framesForTemplate]);

  // Load photos
  const [photos, setPhotos] = useState([]);

  // UI state
  const [tone, setTone] = useState("normal"); // "normal" | "bw"
  const [frameId, setFrameId] = useState(templateActiveFrameId ?? null);

  useEffect(() => {
    if (!templateActiveFrameId) return;
    if (framesToShow.some(f => f.id === templateActiveFrameId)) {
      setFrameId(templateActiveFrameId);
    }
  }, [templateActiveFrameId, framesToShow]);

  useEffect(() => {
    if (framesToShow.length === 0) return;
    if (!framesToShow.some(f => f.id === frameId)) {
      setFrameId(framesToShow[0].id);
    }
  }, [framesToShow, frameId]);

  const [pickedBgHex, setPickedBgHex] = useState(null);

  // Print quantity: ONLY for business + perPhoto. Otherwise forced to 1 and hidden.
  const [quantity, setQuantity] = useState(1);

  const [isPreparing, setIsPreparing] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [error, setError] = useState("");

  // Pop-up invoice/payment state
  const [popupOpen, setPopupOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(null); // "cash" | "gateway"
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // Pop-up QR state (mirrors PaymentScreen gateway flow)
  const [popupQrDataUrl, setPopupQrDataUrl] = useState(null);
  const [popupQrLoading, setPopupQrLoading] = useState(false);
  const [popupQrError, setPopupQrError] = useState(null);
  const [popupQrSourceId, setPopupQrSourceId] = useState(null);
  const [popupPaymentConfirmed, setPopupPaymentConfirmed] = useState(false);
  const popupQrActiveRef = useRef(false);

  // ---------- Event resolution ----------
  const [resolvedEventId, setResolvedEventId] = useState(eventId);

  // If parent didn’t pass an event, read the persisted currentEventId
  useEffect(() => {
    (async () => {
      if (event || !api?.getCurrentEventId) return;
      try {
        const id = await api.getCurrentEventId();
        if (id) setResolvedEventId(id);
      } catch (e) {
        console.warn("getCurrentEventId failed:", e);
      }
    })();
  }, [api, event]);

  // Load the event using resolvedEventId (or use the provided event prop)
  useEffect(() => {
    (async () => {
      if (event) { setCurrentEvent(event); return; }
      if (!api?.getEvents) return;
      try {
        const evts = await api.getEvents();
        const found = Array.isArray(evts)
          ? (evts.find(e => e?.id === resolvedEventId) || evts[0])
          : null;
        setCurrentEvent(found || null);
      } catch (err) {
        console.warn("Failed to load events:", err);
        setCurrentEvent(null);
      }
    })();
  }, [api, event, resolvedEventId]);

  const toneEffectsToShow = useMemo(() => {
    if (!currentEvent) return TONEEFFECTS;
    if (appliedToneEffectIds.size === 0) return TONEEFFECTS;
    const filtered = TONEEFFECTS.filter(t => appliedToneEffectIds.has(t.id));
    return filtered.length ? filtered : TONEEFFECTS;
  }, [currentEvent, appliedToneEffectIds]);

  // Keep selected tone valid as filters change
  useEffect(() => {
    if (toneEffectsToShow.length && !toneEffectsToShow.some(t => t.id === tone)) {
      setTone(toneEffectsToShow[0].id);
    }
  }, [toneEffectsToShow, tone]);

  // Keep selections valid as lists change (you already have similar guards)
  useEffect(() => {
    if (framesToShow.length && !framesToShow.some(f => f.id === frameId)) {
      setFrameId(framesToShow[0].id);
    }
  }, [framesToShow, frameId]);

  const activeFrame = useMemo(() => {
    // If nothing is attached/selected, return null to represent "no frame".
    const entry = framesToShow.find(f => f.id === frameId);
    if (!entry) return null;
    if (entry.kind === "style") {
      const base = FRAMES.find(f => f.id === entry.styleId) ?? FRAMES[0];
      return { ...base, overlay: null, kind: "style", useBgColor: false, bgHexes: null, selectedColor: null };
    }
    const base = FRAMES.find(f => f.id === entry.styleId) ?? FRAMES[0];
    return {
      ...base,
      id: entry.id,
      label: entry.label,
      overlay: entry.overlay,
      kind: entry.kind,
      useBgColor: !!entry.useBgColor,
      bgHexes: Array.isArray(entry.bgHexes) ? entry.bgHexes : null,
      selectedColor: entry.selectedColor ?? null,
    };
  }, [frameId, framesToShow]);

  const toneFilter = useMemo(() => TONE_FILTERS[tone] ?? TONE_FILTERS.normal, [tone]);

  // Ensure selected frame is within allowed list; else default to first allowed
  useEffect(() => {
    if (framesToShow.length && !framesToShow.some(f => f.id === frameId)) {
      setFrameId(framesToShow[0].id);
    }
  }, [framesToShow, frameId]);


  useEffect(() => {
    const first = activeFrame?.selectedColor ?? activeFrame?.bgHexes?.[0] ?? null;
    setPickedBgHex(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFrame?.id]);


  // Derived per-language dictionary
  const langCode =
    currentEvent?.settings?.language ??
    globalSettings?.language ??
    "en";
  const t = resolveLocale(langCode);

  const hasAutoProceededRef = useRef(false);
  const isAutoProceedingRef = useRef(false);
  const pendingComposedRef = useRef(null);
  const pendingComposedBurstRef = useRef(null);

  useEffect(() => {
    (async () => {
      if (!api) return;
      try {
        const [a, s] = await Promise.all([
          api.getAppearance?.(),
          api.getSettings?.(),
        ]);
        if (a) setGlobalAppearance(a);
        if (s) setGlobalSettings(s);
      } catch (err) {
        console.warn("Failed to load appearance/settings:", err);
      }
    })();
  }, [api]);

  // After currentEvent resolves, ensure selections are valid
  useEffect(() => {
    if (!currentEvent) return;
    if (framesToShow.length && !framesToShow.some(f => f.id === frameId)) {
      setFrameId(framesToShow[0].id);
    }
    if (toneEffectsToShow.length && !toneEffectsToShow.some(t => t.id === tone)) {
      setTone(toneEffectsToShow[0].id);
    }
  }, [currentEvent, framesToShow, toneEffectsToShow]);


  /* ------------------------------------------------------------------ */
  /* Appearance resolution                                               */
  /* ------------------------------------------------------------------ */
  const appearance = useMemo(() => {
    const evApp = currentEvent?.appearance || {};
    const gApp = globalAppearance || {};
    const merged = { ...DEFAULT_APPEARANCE, ...gApp, ...evApp };

    return {
      ...merged,
      logoPath: merged.logoPath ? normalizeToFileUrl(merged.logoPath) : null,
      backgroundMediaPath: merged.backgroundMediaPath
        ? normalizeToFileUrl(merged.backgroundMediaPath)
        : null,
    };
  }, [currentEvent, globalAppearance]);

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
    buttonBgColor, buttonHoverColor, buttonFontColor, buttonFont,
  } = appearance;
  const logoScale = (logoSize ?? 100) / 100;


  // Load fonts like AdminDashboard
  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);


  /* ------------------------------------------------------------------ */
  /* Pricing rules (per your requirements)                               */
  /* - Allow extra copies ONLY when: Business + perPhoto                 */
  /* - First print already paid                                          */
  /* - Additional fee = (quantity - 1) * unitPrice                       */
  /* - If NOT allowed, hide quantity and force quantity=1                */
  /* ------------------------------------------------------------------ */
  const appMode = useMemo(() => {
    const ev = currentEvent?.settings?.appMode;
    const g = globalSettings?.appMode;
    return ev ?? g ?? "rental";
  }, [currentEvent, globalSettings]);

  const pricingModel = useMemo(() => {
    const ev = currentEvent?.settings?.business?.pricing?.model;
    const g = globalSettings?.business?.pricing?.model;
    return ev ?? g ?? "perSession";
  }, [currentEvent, globalSettings]);

  const business = useMemo(() => {
    return currentEvent?.settings?.business ?? globalSettings?.business ?? {};
  }, [currentEvent, globalSettings]);

  const paymentEnabled = useMemo(() => {
    return business?.paymentEnabled ?? (appMode === "business");
  }, [business, appMode]);

  const activeGateway = useMemo(() => business?.activeProvider ?? null, [business]);

  const gatewayLabel = useMemo(() => {
    return { paymongo: "PayMongo", stripe: "Stripe", xendit: "Xendit", paypal: "PayPal" }[activeGateway] ?? activeGateway ?? "QR Payment";
  }, [activeGateway]);

  const currency = useMemo(() => {
    const ev = currentEvent?.settings?.business?.pricing?.currency;
    const g = globalSettings?.business?.pricing?.currency;
    return (ev ?? g ?? "PHP");
  }, [currentEvent, globalSettings]);

  const hasCashProvider = useMemo(() => Boolean(business?.payment?.providers?.cash), [business]);
  const gatewayConfigured = useMemo(() => Boolean(activeGateway && paymentEnabled), [activeGateway, paymentEnabled]);
  const gatewayCurrencyMatch = useMemo(() => {
    if (!activeGateway) return true;
    const supported = GATEWAY_SUPPORTED_CURRENCIES[activeGateway];
    if (!supported) return true; // unknown gateway — don't restrict
    return supported.includes(String(currency).toUpperCase());
  }, [activeGateway, currency]);
  const hasGatewayProvider = useMemo(() => gatewayConfigured && gatewayCurrencyMatch, [gatewayConfigured, gatewayCurrencyMatch]);

  // Allow extra copies ONLY when Business + payment enabled + perSession
  const allowExtraCopies = useMemo(() => {
    return appMode === "business" && paymentEnabled && pricingModel === "perSession";
  }, [appMode, paymentEnabled, pricingModel]);

  // The "unit price" for extra copies in perSession mode.
  // IMPORTANT CHANGE (fix additional fee):
  // Use pricePerPhoto directly (not multiplied by slots) to represent "per print/copy".

  const unitPrice = useMemo(() => {
    const ev = currentEvent?.settings?.business?.pricing?.additionalPrintPrice;
    const g = globalSettings?.business?.pricing?.additionalPrintPrice;
    return Number(ev ?? g ?? 0);
  }, [currentEvent, globalSettings]);

  const taxEnabled = useMemo(() => {
    const ev = currentEvent?.settings?.business?.pricing?.taxEnabled;
    const g = globalSettings?.business?.pricing?.taxEnabled;
    return !!(ev ?? g ?? false);
  }, [currentEvent, globalSettings]);

  const taxRate = useMemo(() => {
    const ev = currentEvent?.settings?.business?.pricing?.taxRate;
    const g = globalSettings?.business?.pricing?.taxRate;
    return Number(ev ?? g ?? 0);
  }, [currentEvent, globalSettings]);

  const baseSessionPrice = useMemo(() => {
    const ev = currentEvent?.settings?.business?.pricing?.pricePerSession;
    const g = globalSettings?.business?.pricing?.pricePerSession;
    return Number(ev ?? g ?? currentEvent?.settings?.price ?? 0);
  }, [currentEvent, globalSettings]);

  // When extra copies are not allowed, force quantity = 1
  useEffect(() => {
    if (!allowExtraCopies) {
      setQuantity(1);
      setPopupOpen(false);
      setPaymentMethod(null);
      pendingComposedRef.current = null;
    }
  }, [allowExtraCopies]);


  // Also clear when main inputs change
  useEffect(() => {
    pendingComposedRef.current = null;
  }, [template, tone, frameId, photos]);


  const additionalFee = useMemo(() => {
    if (!allowExtraCopies) return 0;
    return Math.max(0, (quantity - 1) * unitPrice);
  }, [allowExtraCopies, quantity, unitPrice]);

  /* ------------------------------------------------------------------ */
  /* Photos load                                                        */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    (async () => {
      try {
        if (Array.isArray(photosProp) && photosProp.length > 0) {
          setPhotos([...photosProp].map(normalizeToFileUrl));
          return;
        }

        const imgs = await api?.getCapturedPhotos?.(resolvedEventId);

        // 🔧 FIX: ensure oldest → newest
        const ordered = (imgs || []).slice().reverse();

        setPhotos(ordered.map(normalizeToFileUrl));
      } catch (err) {
        console.error("Failed to load photos:", err);
        setPhotos([]);
      }
    })();
  }, [api, resolvedEventId, photosProp]);

  /* ------------------------------------------------------------------ */
  /* Countdown                                                          */
  /* Requirement: when timer hits 0, proceed to next step automatically */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (timeLeft <= 0) return;
    const id = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timeLeft]);

  // AUTO-PROCEED FIX — prevent firing until composition is done
  useEffect(() => {
    if (timeLeft !== 0) return;

    // If still composing or preparing, WAIT
    if (isComposing || isPreparing) {
      hasAutoProceededRef.current = true;
      return;
    }

    if (hasAutoProceededRef.current) return;
    if (isAutoProceedingRef.current) return;

    isAutoProceedingRef.current = true;
    handlePrimaryAction(true);
  }, [timeLeft, isComposing, isPreparing]);

  const decQty = () => setQuantity((q) => Math.max(1, q - 1));
  const incQty = () => setQuantity((q) => Math.min(10, q + 1));


  /* ------------------------------------------------------------------ */
  /* Popup helpers                                                       */
  /* ------------------------------------------------------------------ */

  // Auto-select method when only one provider is available
  useEffect(() => {
    if (!popupOpen) return;
    if (hasCashProvider && !hasGatewayProvider) setPaymentMethod("cash");
    else if (!hasCashProvider && hasGatewayProvider) setPaymentMethod("gateway");
  }, [popupOpen, hasCashProvider, hasGatewayProvider]);

  // Start gateway QR when gateway method is selected
  useEffect(() => {
    if (!popupOpen || paymentMethod !== "gateway" || popupPaymentConfirmed) return;
    if (popupQrActiveRef.current && popupQrDataUrl && popupQrSourceId) return;

    let cancelled = false;
    popupQrActiveRef.current = true;
    setPopupQrLoading(true);
    setPopupQrError(null);
    setPopupQrDataUrl(null);
    setPopupQrSourceId(null);

    (async () => {
      try {
        const res = await api?.startGatewayPayment?.({ amount: additionalFee, currency, eventId: resolvedEventId });
        if (cancelled) return;
        if (res?.ok && res.qrDataUrl) {
          setPopupQrDataUrl(res.qrDataUrl);
          setPopupQrSourceId(res.sessionId ?? res.orderId ?? null);
        } else {
          setPopupQrError(res?.error || "Failed to create payment session");
        }
      } catch (err) {
        if (!cancelled) setPopupQrError(err?.message || "Payment error");
      } finally {
        if (!cancelled) setPopupQrLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [popupOpen, paymentMethod, popupPaymentConfirmed, additionalFee, currency, resolvedEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for gateway payment confirmation while popup is open
  useEffect(() => {
    if (!popupOpen) return;
    const unsub = api?.onPaymentConfirmed?.((data) => {
      setPopupPaymentConfirmed(true);
      api?.recordPayment?.({
        method: "gateway",
        amount: additionalFee,
        currency,
        paymentId: data.paymentId,
        sourceId: data.sourceId,
        eventId: resolvedEventId,
        confirmedAt: new Date().toISOString(),
      }).catch?.(() => {});
      setTimeout(() => confirmAndProceedFromPopup("gateway"), 1200);
    });
    const unsubFail = api?.onPaymentFailed?.((data) => {
      setPopupQrError(data?.reason || "Payment failed or expired");
      setPopupQrDataUrl(null);
      setPopupQrSourceId(null);
      popupQrActiveRef.current = false;
    });
    return () => { unsub?.(); unsubFail?.(); };
  }, [popupOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel active QR session on unmount
  useEffect(() => {
    return () => {
      if (popupQrSourceId) api?.cancelPayment?.({ sourceId: popupQrSourceId, sessionId: popupQrSourceId });
    };
  }, [popupQrSourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const closePopup = () => {
    if (popupQrSourceId) api?.cancelPayment?.({ sourceId: popupQrSourceId, sessionId: popupQrSourceId });
    setPopupQrDataUrl(null);
    setPopupQrSourceId(null);
    setPopupQrLoading(false);
    setPopupQrError(null);
    setPopupPaymentConfirmed(false);
    popupQrActiveRef.current = false;
    setPopupOpen(false);
    setPaymentMethod(null);
    setError("");
    isAutoProceedingRef.current = false;
  };

  const selectPopupMethod = (method) => {
    if (paymentMethod === "gateway" && popupQrSourceId) {
      api?.cancelPayment?.({ sourceId: popupQrSourceId, sessionId: popupQrSourceId });
      setPopupQrDataUrl(null);
      setPopupQrSourceId(null);
      popupQrActiveRef.current = false;
    }
    setPaymentMethod(method);
    setPopupQrError(null);
  };

  /* ------------------------------------------------------------------ */
  /* Compose image and proceed                                           */
  /* - If extra copies enabled and quantity > 1 => popup invoice + pay   */
  /* - Else go straight to onNext                                        */
  /* ------------------------------------------------------------------ */
  const handlePrimaryAction = async (isAuto = false) => {
    setError("");

    if (!template?.slots?.length || photos.length === 0) {
      setError("No photos available to print.");
      isAutoProceedingRef.current = false;
      return;
    }

    if (isComposing) return;
    setIsComposing(true);
    setIsPreparing(true);

    let composed;
    let composedBurst;
    let savedFinal = null;

    try {
      const resolvedDpi = Number(globalSettings?.printDpi || globalSettings?.dpi || 300);

      composed = await composePrintImage({
        layout: normalizedLayout,
        dpi: resolvedDpi,
        frame: activeFrame
          ? { ...activeFrame, pickedBgHex }
          : { color: "#ffffff", padding: 0, borderWidth: 0, overlay: null, kind: "none" },
        tone,
        slots: template.slots,
        photos,
        watermark,
      });

      composedBurst = await composeBurstPrintImage({
        template: {
          ...template,
          slots: resolvedLayoutConfig.slots,
        },
        slots: resolvedLayoutConfig.slots,
        width: resolvedLayoutConfig.width,
        height: resolvedLayoutConfig.height,
      });

      savedFinal = await saveComposedOutput(composed);

      if (isAuto) {
        const qr = galleryEnabled ? await api?.getDownloadQr?.(eventId) : null;

        hasAutoProceededRef.current = true;
        isAutoProceedingRef.current = false;

        {
          const taxAmount = taxEnabled && appMode === "business"
            ? Math.round(baseSessionPrice * (taxRate / 100) * 100) / 100
            : 0;
          onNext?.({
            composedImage: composed,
            composedBurstImage: composedBurst,
            composedImagePath: savedFinal?.savedPath ?? null,
            composedImageUrl: savedFinal?.fileUrl ?? null,
            sessionId: sessionId || "default",
            layout: normalizedLayout,
            printMode: templateSelection?.previewMeta?.printMode ?? "single",
            layoutConfig: resolvedLayoutConfig,
            slotVideoMap: resolvedLayoutConfig.slotVideoMap,
            motionBackgroundColor:
              activeFrame?.useBgColor
                ? (pickedBgHex || activeFrame?.selectedColor || activeFrame?.bgHexes?.[0] || "#ffffff")
                : (activeFrame?.color || "#ffffff"),
            frameOverlayDataUrl: activeFrame?.overlay?.[normalizedLayout] || null,
            qrImage: qr,
            quantity: 1,
            pricing: {
              currency,
              appMode,
              pricingModel,
              baseAmount: baseSessionPrice,
              unitPrice,
              additionalPrints: 0,
              additionalFee: 0,
              taxEnabled,
              taxRate,
              taxAmount,
              totalAmount: baseSessionPrice + taxAmount,
              firstPrintAlreadyPaid: true,
              autoSkippedExtras: true,
            },
            tone,
            frameId,
            selectedToneEffectId: tone,
            selectedFrameStyleId: activeFrame.id,
            auto: true,
          });
        }
        return;
      }

      if (allowExtraCopies && quantity > 1 && additionalFee > 0) {
        pendingComposedRef.current = composed;
        pendingComposedBurstRef.current = composedBurst;
        setPopupOpen(true);
        setPaymentMethod(null);
        isAutoProceedingRef.current = false;
        return;
      }

      const qr = galleryEnabled ? await api?.getDownloadQr?.(eventId) : null;

      hasAutoProceededRef.current = true;
      isAutoProceedingRef.current = false;

      {
        const taxAmount = taxEnabled && appMode === "business"
          ? Math.round(baseSessionPrice * (taxRate / 100) * 100) / 100
          : 0;
        onNext?.({
          composedImage: composed,
          composedBurstImage: composedBurst,
          composedImagePath: savedFinal?.savedPath ?? null,
          composedImageUrl: savedFinal?.fileUrl ?? null,
          sessionId: sessionId || "default",
          layout: normalizedLayout,
          printMode: templateSelection?.previewMeta?.printMode ?? "single",
          layoutConfig: resolvedLayoutConfig,
          slotVideoMap: resolvedLayoutConfig.slotVideoMap,
          motionBackgroundColor:
            activeFrame?.useBgColor
              ? (pickedBgHex || activeFrame?.selectedColor || activeFrame?.bgHexes?.[0] || "#ffffff")
              : (activeFrame?.color || "#ffffff"),
          frameOverlayDataUrl: activeFrame?.overlay?.[normalizedLayout] || null,
          qrImage: qr,
          quantity: 1,
          pricing: {
            currency,
            appMode,
            pricingModel,
            baseAmount: baseSessionPrice,
            unitPrice,
            additionalPrints: 0,
            additionalFee: 0,
            taxEnabled,
            taxRate,
            taxAmount,
            totalAmount: baseSessionPrice + taxAmount,
            firstPrintAlreadyPaid: true,
          },
          tone,
          frameId,
          selectedToneEffectId: tone,
          selectedFrameStyleId: activeFrame.id,
          auto: isAuto,
        });
      }
    } catch (err) {
      console.error(err);
      setError("Unable to prepare print. Please try again.");
      isAutoProceedingRef.current = false;
    } finally {
      setIsComposing(false);
      setIsPreparing(false);
    }

    pendingComposedRef.current = composed;
    pendingComposedBurstRef.current = composedBurst;
  };

  /* ------------------------------------------------------------------ */
  /* Pop-up payment confirm (simple)                                     */
  /* - First print already paid                                          */
  /* - Charge only additionalFee                                         */
  /* - If host API exists -> chargeAdditionalPayment({amount})           */
  /* - Else simulate success                                             */
  /* ------------------------------------------------------------------ */
  const confirmAndProceedFromPopup = async (forcedMethod) => {
    setError("");

    if (!allowExtraCopies || additionalFee <= 0) {
      closePopup();
      return;
    }

    const resolvedMethod = forcedMethod ?? paymentMethod;

    if (!resolvedMethod && (hasCashProvider || hasGatewayProvider)) {
      setError("Please select a payment method.");
      return;
    }

    setIsProcessingPayment(true);
    try {
      const composed = pendingComposedRef.current;
      const composedBurst = pendingComposedBurstRef.current;

      if (!composed) {
        setError("Missing composed image. Please try again.");
        return;
      }

      // Gateway payments are already confirmed by the payment system; only charge for cash
      if (resolvedMethod === "cash" && api?.chargeAdditionalPayment) {
        const res = await api.chargeAdditionalPayment({
          amount: additionalFee,
          method: "cash",
        });

        if (!res?.success) {
          setError("Payment failed. Please try again.");
          return;
        }
      } else if (resolvedMethod !== "gateway") {
        await new Promise((r) => setTimeout(r, 700));
      }

      const qr = galleryEnabled ? await api?.getDownloadQr?.(eventId) : null;

      closePopup();

      {
        const taxAmount = taxEnabled && appMode === "business"
          ? Math.round(baseSessionPrice * (taxRate / 100) * 100) / 100
          : 0;
        onNext?.({
          composedImage: composed,
          composedBurstImage: composedBurst,
          composedImagePath: null,
          composedImageUrl: null,
          sessionId: sessionId || "default",
          layout: normalizedLayout,
          printMode: templateSelection?.previewMeta?.printMode ?? "single",
          layoutConfig: resolvedLayoutConfig,
          slotVideoMap: resolvedLayoutConfig.slotVideoMap,
          motionBackgroundColor:
            activeFrame?.useBgColor
              ? (pickedBgHex || activeFrame?.selectedColor || activeFrame?.bgHexes?.[0] || "#ffffff")
              : (activeFrame?.color || "#ffffff"),
          frameOverlayDataUrl: activeFrame?.overlay?.[normalizedLayout] || null,
          qrImage: qr,
          quantity,
          pricing: {
            currency,
            appMode,
            pricingModel,
            baseAmount: baseSessionPrice,
            unitPrice,
            additionalPrints: quantity - 1,
            additionalFee,
            taxEnabled,
            taxRate,
            taxAmount,
            totalAmount: baseSessionPrice + additionalFee + taxAmount,
            firstPrintAlreadyPaid: true,
          },
          payment: {
            method: resolvedMethod,
            amount: additionalFee,
          },
          tone,
          frameId,
          selectedToneEffectId: tone,
          selectedFrameStyleId: activeFrame?.id,
        });
      }

      hasAutoProceededRef.current = true;
      isAutoProceedingRef.current = false;
    } catch (err) {
      console.error(err);
      setError("Payment processing error. Please try again.");
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const isGif = !!backgroundMediaPath && backgroundMediaPath.toLowerCase().endsWith(".gif");

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
      className="w-full h-screen overflow-hidden flex flex-col p-3"
      style={{
        backgroundColor: bgColor,
        fontFamily: generalFont,
        color: generalFontColor,
      }}
    >

      {/* ── Header: logo + timer — always in flow so scroll never overlaps ── */}
      <div className="shrink-0 flex items-center" style={{ padding: isPortrait ? '2vh 4vw' : '6px 24px 4px' }}>
        <div style={{ flex: 1 }}>
          {logoPath ? (
            isPortrait
              ? <img src={logoPath} alt="logo" style={{ maxHeight: `${Math.round(60 * logoScale)}px` }} className="w-auto object-contain" />
              : <img src={logoPath} alt="logo" style={{ maxWidth: `${Math.round(300 * logoScale)}px` }} className="object-contain" />
          ) : isPortrait ? (
            <span className="font-bold" style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(18px, 2.5vw, 46px)' }}>{boothName}</span>
          ) : (
            <div>
              <h1 className="font-bold" style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(22px, 3.5vw, 56px)' }}>{boothName}</h1>
              {!!tagline && <p style={{ color: generalFontColor, fontSize: 'clamp(12px, 1.4vw, 22px)' }}>{tagline}</p>}
            </div>
          )}
        </div>
        <div className="rounded-full font-bold shadow-sm px-5 py-2" style={{
          backgroundColor: buttonBgColor,
          color: buttonFontColor,
          fontFamily: generalFont,
          fontSize: isPortrait ? 'clamp(16px, 2vw, 38px)' : 'clamp(14px, 1.8vw, 26px)',
        }} aria-live="polite">
          {Math.max(0, timeLeft)}s
        </div>
        {!isPortrait && <div style={{ flex: 1 }} />}
      </div>

      {/* ── Body: 2-column (landscape) or reordered stack (portrait) ── */}
      <div className={`flex-1 min-h-0 ${isPortrait ? "flex flex-col" : "grid grid-cols-2 pb-[50px]"}`}>

      {/* Controls column — portrait: bottom flex-1, landscape: left column */}
      <div
        className={isPortrait ? "flex-1 min-h-0 flex flex-col" : "col-span-1 h-full min-h-0 flex flex-col"}
        style={isPortrait ? { order: 2 } : undefined}
      >
        {isPortrait ? (
          /* ── Portrait: compact horizontal chip rows, no vertical scroll ── */
          <div className="shrink-0 flex flex-col" style={{ padding: '1vh 4vw 0' }}>
            {/* Tone chips */}
            <div className="shrink-0 mb-3">
              <div className="font-bold mb-2" style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(14px, 2vw, 28px)' }}>
                {t.tone}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                {toneEffectsToShow.map((f) => {
                  const isActive = tone === f.id;
                  const label = f.label[String(langCode).toLowerCase().startsWith("tl") ? "tl" : "en"];
                  return (
                    <button key={f.id} onClick={() => setTone(f.id)}
                      className="shrink-0 rounded-full px-4 py-2 font-semibold transition-all"
                      style={{ fontFamily: buttonFont, backgroundColor: isActive ? buttonBgColor : "rgba(255,255,255,0.06)", color: isActive ? buttonFontColor : generalFontColor, border: `1.5px solid ${isActive ? buttonBgColor : "rgba(255,255,255,0.18)"}`, fontSize: 'clamp(12px, 1.8vw, 22px)', whiteSpace: 'nowrap' }}
                    >{label}</button>
                  );
                })}
              </div>
            </div>
            {/* Frame chips */}
            <div className="shrink-0 mb-3">
              <div className="font-bold mb-2" style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(14px, 2vw, 28px)' }}>
                {t.frame}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                {framesLoading ? (
                  <div className="text-sm rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white/60 shrink-0">Loading frames…</div>
                ) : framesLoadError ? (
                  <button onClick={loadFrames} className="shrink-0 text-sm rounded-xl border border-yellow-400/30 bg-yellow-500/10 px-4 py-2 text-yellow-200">
                    Tap to reload frames
                  </button>
                ) : framesToShow.length === 0 ? (
                  <div className="text-sm rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-red-200 shrink-0">No frames attached.</div>
                ) : (
                  framesToShow.map((f) => {
                    const isActive = frameId === f.id;
                    const labelText = f.label ? f.label[String(langCode).toLowerCase().startsWith("tl") ? "tl" : "en"] : f?.label?.en ?? "Frame";
                    return (
                      <button key={f.id} type="button" onClick={() => setFrameId(f.id)}
                        className="shrink-0 rounded-full px-4 py-2 font-semibold transition-all"
                        style={{ fontFamily: buttonFont, backgroundColor: isActive ? buttonBgColor : "rgba(255,255,255,0.06)", color: isActive ? buttonFontColor : generalFontColor, border: `1.5px solid ${isActive ? buttonBgColor : "rgba(255,255,255,0.18)"}`, fontSize: 'clamp(12px, 1.8vw, 22px)', whiteSpace: 'nowrap' }}
                      >{labelText}</button>
                    );
                  })
                )}
              </div>
            </div>
            {/* Background color chips */}
            {activeFrame?.useBgColor && Array.isArray(activeFrame?.bgHexes) && activeFrame.bgHexes.length > 0 && (
              <div className="shrink-0 mb-3">
                <div className="font-bold mb-2" style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(14px, 2vw, 28px)' }}>Background</div>
                <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  {activeFrame.bgHexes.map((hex) => {
                    const isActive = pickedBgHex === hex;
                    return (
                      <button key={hex} type="button" onClick={() => setPickedBgHex(hex)} title={hex}
                        className="shrink-0 w-10 h-10 rounded-full transition-all flex items-center justify-center"
                        style={{ backgroundColor: hex, border: `3px solid ${isActive ? buttonBgColor : "rgba(255,255,255,0.22)"}`, transform: isActive ? "scale(1.15)" : "scale(1)" }}
                      >
                        {isActive && <span className="text-white text-sm font-bold" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Quantity compact row */}
            {allowExtraCopies && (
              <div className="shrink-0 mb-2">
                <div className="flex items-center justify-between rounded-2xl px-4 py-3"
                  style={{ backgroundColor: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)" }}
                >
                  <div>
                    <div className="font-bold" style={{ color: headerFontColor, fontSize: 'clamp(12px, 1.6vw, 22px)' }}>Print quantity</div>
                    <div className="text-xs opacity-80" style={{ color: generalFontColor }}>+{formatMoney(unitPrice, currency)} per extra</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={decQty} className="w-8 h-8 rounded-full bg-white text-black font-bold text-base flex items-center justify-center">−</button>
                    <span className="w-8 text-center font-bold" style={{ color: headerFontColor, fontSize: 'clamp(14px, 1.8vw, 24px)' }}>{quantity}</span>
                    <button onClick={incQty} className="w-8 h-8 rounded-full bg-white text-black font-bold text-base flex items-center justify-center">+</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Landscape: scrollable grid layout ── */
          <div className="flex-1 min-h-0 overflow-y-auto light-scroll px-8 pt-4 pb-4">
            {/* Tone */}
            <div className="mb-10">
              <div className="text-5xl font-bold mb-4" style={{ fontFamily: headerFont, color: headerFontColor }}>{t.tone}</div>
              <div className={`grid gap-3 ${isPortrait2K ? "grid-cols-4" : "grid-cols-2 md:grid-cols-3"}`}>
                {toneEffectsToShow.map((f) => {
                  const isActive = tone === f.id;
                  const label = f.label[String(langCode).toLowerCase().startsWith("tl") ? "tl" : "en"];
                  return (
                    <button key={f.id} onClick={() => setTone(f.id)}
                      className="group relative min-h-[70px] rounded-[28px] px-5 py-4 text-left transition-all duration-200"
                      style={{ fontFamily: buttonFont, backgroundColor: isActive ? buttonBgColor : "rgba(255,255,255,0.06)", color: isActive ? buttonFontColor : generalFontColor, border: `1.5px solid ${isActive ? buttonBgColor : "rgba(255,255,255,0.18)"}`, boxShadow: isActive ? "0 12px 30px rgba(0,0,0,0.22)" : "0 8px 20px rgba(0,0,0,0.12)" }}
                      onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.borderColor = buttonBgColor; e.currentTarget.style.transform = "translateY(-2px)"; } }}
                      onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; e.currentTarget.style.transform = "translateY(0)"; } }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div><div className="text-lg font-bold leading-tight">{label}</div></div>
                        <div className="shrink-0 w-4 h-4 rounded-full mt-1" style={{ backgroundColor: isActive ? buttonFontColor : "transparent", border: `2px solid ${isActive ? buttonFontColor : "rgba(255,255,255,0.35)"}` }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Frame */}
            <div className="mb-10">
              <div className="text-5xl font-bold mb-4" style={{ fontFamily: headerFont, color: headerFontColor }}>{t.frame}</div>
              <div className={`grid gap-3 ${isPortrait2K ? "grid-cols-4" : "grid-cols-2 md:grid-cols-3"}`}>
                {framesLoading ? (
                  <div className="col-span-full rounded-[28px] border border-white/20 bg-white/10 px-5 py-4 text-sm text-white/60">Loading frames…</div>
                ) : framesLoadError ? (
                  <button onClick={loadFrames} className="col-span-full rounded-[28px] border border-yellow-400/30 bg-yellow-500/10 px-5 py-4 text-sm text-yellow-200 text-left">
                    Failed to load frames — tap to retry →
                  </button>
                ) : framesToShow.length === 0 ? (
                  <div className="col-span-full rounded-[28px] border border-red-400/30 bg-red-500/10 px-5 py-4 text-sm text-red-200">No frames are attached to this template yet.</div>
                ) : (
                  framesToShow.map((f) => {
                    const isActive = frameId === f.id;
                    const labelText = f.label ? f.label[String(langCode).toLowerCase().startsWith("tl") ? "tl" : "en"] : f?.label?.en ?? "Frame";
                    return (
                      <button key={f.id} type="button" onClick={() => setFrameId(f.id)}
                        className="group relative min-h-[70px] rounded-[28px] px-5 py-4 text-left transition-all duration-200"
                        style={{ fontFamily: buttonFont, backgroundColor: isActive ? buttonBgColor : "rgba(255,255,255,0.06)", color: isActive ? buttonFontColor : generalFontColor, border: `1.5px solid ${isActive ? buttonBgColor : "rgba(255,255,255,0.18)"}`, boxShadow: isActive ? "0 12px 30px rgba(0,0,0,0.22)" : "0 8px 20px rgba(0,0,0,0.12)" }}
                        onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.borderColor = buttonBgColor; e.currentTarget.style.transform = "translateY(-2px)"; } }}
                        onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; e.currentTarget.style.transform = "translateY(0)"; } }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div><div className="text-lg font-bold leading-tight">{labelText}</div></div>
                          <div className="shrink-0 w-4 h-4 rounded-full mt-1" style={{ backgroundColor: isActive ? buttonFontColor : "transparent", border: `2px solid ${isActive ? buttonFontColor : "rgba(255,255,255,0.35)"}` }} />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            {/* Background Color */}
            {activeFrame?.useBgColor && Array.isArray(activeFrame?.bgHexes) && activeFrame.bgHexes.length > 0 && (
              <div className="mb-10">
                <div className="text-5xl font-bold mb-4" style={{ fontFamily: headerFont, color: headerFontColor }}>Background Color</div>
                <div className="flex flex-wrap gap-4">
                  {activeFrame.bgHexes.map((hex) => {
                    const isActive = pickedBgHex === hex;
                    return (
                      <button key={hex} type="button" onClick={() => setPickedBgHex(hex)} title={hex}
                        className="relative w-16 h-16 rounded-[20px] transition-all duration-200"
                        style={{ backgroundColor: hex, border: `3px solid ${isActive ? buttonBgColor : "rgba(255,255,255,0.22)"}`, boxShadow: isActive ? `0 0 0 4px ${buttonBgColor}35, 0 12px 28px rgba(0,0,0,0.2)` : "0 8px 18px rgba(0,0,0,0.12)", transform: isActive ? "translateY(-2px)" : "translateY(0)" }}
                      >
                        {isActive && <div className="absolute inset-0 flex items-center justify-center text-white text-lg font-bold">✓</div>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Quantity */}
            {allowExtraCopies && (
              <div className="mb-8">
                <div className="rounded-[30px] px-6 py-5" style={{ backgroundColor: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", boxShadow: "0 14px 30px rgba(0,0,0,0.14)" }}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-2xl font-bold" style={{ color: headerFontColor }}>Print quantity</div>
                      <div className="text-sm mt-1 opacity-80" style={{ color: generalFontColor }}>First print is already paid. Additional <strong>{formatMoney(unitPrice, currency)}</strong> for each extra copy.</div>
                    </div>
                    <div className="flex items-center gap-2 rounded-full px-2 py-2" style={{ backgroundColor: "#ffffff", boxShadow: "0 8px 20px rgba(0,0,0,0.12)" }}>
                      <button onClick={decQty} className="w-11 h-11 rounded-full text-xl font-bold text-black transition">−</button>
                      <div className="min-w-[52px] text-center text-black font-bold text-lg">{quantity}</div>
                      <button onClick={incQty} className="w-11 h-11 rounded-full text-xl font-bold text-black transition">+</button>
                    </div>
                  </div>
                  {quantity > 1 && (
                    <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between text-sm">
                      <span style={{ color: generalFontColor }}>Additional fee</span>
                      <span className="font-bold" style={{ color: headerFontColor }}>{formatMoney(additionalFee, currency)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action — pinned at the bottom of the controls column */}
        <div
          className={`shrink-0 ${isPortrait ? "" : "py-4 px-8"}`}
          style={isPortrait ? { padding: '1vh 4vw 2vh' } : undefined}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => handlePrimaryAction(false)}
              disabled={isPreparing}
              className={`w-full flex items-center justify-center gap-3 px-10 py-5 rounded-full font-bold transition ${isPreparing ? "opacity-60 cursor-not-allowed" : ""
                }`}
              style={{
                backgroundColor: isPreparing ? "rgba(255,255,255,0.25)" : buttonBgColor,
                color: isPreparing ? "#ffffff" : buttonFontColor,
                boxShadow: isPreparing ? "none" : "0 18px 38px rgba(0,0,0,0.22)",
                fontSize: isPortrait ? 'clamp(18px, 2.5vw, 46px)' : '1.5rem',
              }}
              onMouseEnter={(e) => {
                if (!isPreparing) e.currentTarget.style.backgroundColor = buttonHoverColor;
              }}
              onMouseLeave={(e) => {
                if (!isPreparing) e.currentTarget.style.backgroundColor = buttonBgColor;
              }}
            >
              <span>
                {isPreparing
                  ? "Preparing..."
                  : allowExtraCopies && quantity > 1 && additionalFee > 0
                    ? `Pay (${formatMoney(additionalFee, currency)}) to Print`
                    : "Print"}
              </span>
              <span>→</span>
            </button>
          </div>
          {error && <div className="mt-2 text-sm text-red-300">{error}</div>}
        </div>
      </div>

      {/* RIGHT: print preview — portrait: top fixed height, landscape: right column 50% */}
      <div
        className={isPortrait
          ? "shrink-0 flex items-center justify-center overflow-hidden"
          : "col-span-1 h-full overflow-y-auto light-scroll px-8 pt-4 pb-8"
        }
        style={isPortrait ? { padding: '1vh 4vw', order: 1, height: '42vh' } : undefined}
      >

        {(() => {
          const layoutKey = normalizedLayout; // "4x6" | "2x6" | "6x4" | "6x2"

          const aspectStyle = {
            aspectRatio:
              layoutKey === "2x6" ? "2 / 6" :
                layoutKey === "6x4" ? "6 / 4" :
                  layoutKey === "6x2" ? "6 / 2" :
                    "4 / 6",
          };

          const isStrip = layoutKey === "2x6" || layoutKey === "6x2";

          // Width constraints per layout — smaller on tablet to avoid overflow
          const boxClass = (() => {
            if (isPortrait) {
              switch (layoutKey) {
                case "2x6": return "h-[35vh] w-auto";
                case "6x2": return "w-[60vw]";
                case "6x4": return "w-[60vw]";
                default:    return "h-[35vh] w-auto";
              }
            }
            if (isTablet) {
              switch (layoutKey) {
                case "2x6": return "w-full max-w-[200px]";
                case "6x2": return "w-full max-w-[440px]";
                case "6x4": return "w-full max-w-[440px]";
                default:    return "w-full max-w-[400px]";
              }
            }
            switch (layoutKey) {
              case "2x6": return "flex-none h-[75vh]";
              case "6x2": return "flex-none w-[43vw]";
              case "6x4": return "flex-none w-[43vw]";
              default:    return "flex-none h-[75vh]";
            }
          })();

          // Canvas renderer (slots → preview)
          const Canvas = (
            <div className="relative w-full h-full">
              {template.slots.map((slot) => {
                // Clone slots show the same photo as their source slot
                const photoSource = slot?.sourceSlotId
                  ? (template.slots.find(s => s.id === slot.sourceSlotId) ?? slot)
                  : slot;
                const photoIndex = Number(photoSource?.photoIndex);
                // Prefer photoUrl (set by TemplateSelectionScreen) so the preview
                // always works even if the photos[] array is out of sync with the index.
                const src = photoSource?.photoUrl
                  ?? (Number.isFinite(photoIndex) ? photos[photoIndex] : null);
                return (
                  <div
                    key={slot.id}
                    className="absolute overflow-hidden"
                    style={{
                      left: `${slot.x * 100}%`,
                      top: `${slot.y * 100}%`,
                      width: `${slot.w * 100}%`,
                      height: `${slot.h * 100}%`,
                      transform: `rotate(${slot.rotation || 0}deg)`,
                    }}
                  >
                    {src ? (
                      <img
                        src={src}
                        className="w-full h-full object-cover"
                        alt=""
                        style={{ filter: toneFilter }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-gray-300">
                        <PreviewTile src={src} filter={toneFilter} transform={slot?.transform} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );

          // Helper to render overlay img for the active frame
          const OverlayImg = (() => {
            if (!activeFrame || activeFrame.kind !== "custom-overlay") return null;
            const ovSrc =
              activeFrame.overlay?.[layoutKey] ||
              (layoutKey === "2x6" ? activeFrame.overlay?.["4x6"] : null) ||
              (layoutKey === "6x2" ? activeFrame.overlay?.["6x4"] : null) ||
              activeFrame.overlay?.["4x6"] ||
              activeFrame.overlay?.["2x6"] ||
              activeFrame.overlay?.["6x4"] ||
              activeFrame.overlay?.["6x2"];
            return ovSrc ? (
              <img
                src={ovSrc}
                alt=""
                className="absolute inset-0 w-full h-full object-content pointer-events-none"
                style={{ zIndex: 5 }}
              />
            ) : null;
          })();

          // Decide preview background from activeFrame + the user's pick (single color, no gradient)
          function previewBgCssFromFrame(frame, picked, fallbackHex) {
            if (frame?.useBgColor) {
              const single = picked || frame?.selectedColor || frame?.bgHexes?.[0];
              if (single) {
                return { backgroundColor: single };
              }
            }
            // Fallback to style color (static FRAMES color)
            return { backgroundColor: frame?.color || fallbackHex || "#ffffff" };
          }

          // Non-strip layouts → single preview
          if (!isStrip) {
            return (
              <div className="min-h-full flex items-center justify-center gap-6">
                <div
                  className={`shadow-lg border border-black relative ${boxClass}`}
                  style={{
                    ...aspectStyle,
                    ...previewBgCssFromFrame(activeFrame, pickedBgHex, "#ffffff"),
                  }}
                >
                  {Canvas}
                  {OverlayImg}
                </div>
              </div>
            );
          }

          // Strip layouts duplicate:
          // - 2x6 (tall): side-by-side
          // - 6x2 (wide): stacked vertically
          if (layoutKey === "2x6") {
            return (
              <div className="min-h-full flex items-center justify-center gap-6">
                <div className={`shadow-lg border border-black relative ${boxClass}`} style={{
                  ...aspectStyle,
                  ...previewBgCssFromFrame(activeFrame, pickedBgHex, "#ffffff"),
                }}>
                  {Canvas}
                  {OverlayImg}
                </div>
                <div className={`shadow-lg border border-black relative ${boxClass}`} style={{
                  ...aspectStyle,
                  ...previewBgCssFromFrame(activeFrame, pickedBgHex, "#ffffff"),
                }}>
                  {Canvas}
                  {OverlayImg}
                </div>
              </div>
            );
          }

          // 6x2 → stack one above the other (natural for landscape strip)
          return (
            <div className="min-h-full flex flex-col items-center justify-center gap-6">
              <div className={`shadow-lg border border-black relative ${boxClass}`} style={{
                ...aspectStyle,
                ...previewBgCssFromFrame(activeFrame, pickedBgHex, "#ffffff"),
              }}>
                {Canvas}
                {OverlayImg}
              </div>
              <div className={`shadow-lg border border-black relative ${boxClass}`} style={{
                ...aspectStyle,
                ...previewBgCssFromFrame(activeFrame, pickedBgHex, "#ffffff"),
              }}>
                {Canvas}
                {OverlayImg}
              </div>
            </div>
          );
        })()}
      </div>

      </div>{/* ── end body ── */}

      {/* ---------------- Extra copies invoice + payment popup ---------------- */}
      {popupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.18 }}
            className="w-[520px] max-w-[92vw] bg-white text-black rounded-2xl shadow-2xl p-6"
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold" style={{ fontFamily: headerFont }}>Invoice</h2>
                <p className="text-sm text-gray-500">First print is already paid. Pay only for extra copies.</p>
              </div>
              <button onClick={closePopup} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            {/* Invoice summary */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-gray-500">Per extra print</span>
                <span className="font-semibold">{formatMoney(unitPrice, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Extra copies</span>
                <span className="font-semibold">{Math.max(0, quantity - 1)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t">
                <span className="font-bold">Additional fee</span>
                <span className="font-bold">{formatMoney(additionalFee, currency)}</span>
              </div>
            </div>

            {/* Method picker — shown when both are available (gateway may be disabled by currency) */}
            {hasCashProvider && gatewayConfigured && (
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => selectPopupMethod("cash")}
                  className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${paymentMethod === "cash" ? "bg-black text-white border-black" : "bg-white text-black border-gray-200 hover:border-gray-400"}`}
                >
                  Cash
                </button>
                <button
                  onClick={() => gatewayCurrencyMatch && selectPopupMethod("gateway")}
                  disabled={!gatewayCurrencyMatch}
                  title={!gatewayCurrencyMatch ? `${gatewayLabel} does not support ${currency}` : undefined}
                  className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                    !gatewayCurrencyMatch
                      ? "opacity-40 cursor-not-allowed bg-white text-black border-gray-200"
                      : paymentMethod === "gateway"
                        ? "bg-black text-white border-black"
                        : "bg-white text-black border-gray-200 hover:border-gray-400"
                  }`}
                >
                  <span>{gatewayLabel}</span>
                  {!gatewayCurrencyMatch && (
                    <span className="block text-xs font-normal opacity-70">Currency not supported</span>
                  )}
                </button>
              </div>
            )}

            {/* Gateway: QR code panel */}
            {paymentMethod === "gateway" && (
              <div className="flex flex-col items-center text-center gap-3 py-2">
                <p className="text-sm text-gray-600">Scan the QR code with your banking app to pay.</p>
                <div
                  className="flex items-center justify-center rounded-2xl border border-gray-200 shadow-inner"
                  style={{ width: 220, height: 220, backgroundColor: "#fff" }}
                >
                  {popupPaymentConfirmed ? (
                    <div className="flex flex-col items-center gap-2">
                      <svg className="w-14 h-14 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      <span className="text-green-600 font-bold text-sm">Payment confirmed!</span>
                    </div>
                  ) : popupQrLoading ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 border-4 border-gray-200 border-t-indigo-600 rounded-full animate-spin" />
                      <span className="text-gray-400 text-xs">Generating QR…</span>
                    </div>
                  ) : popupQrError ? (
                    <div className="flex flex-col items-center gap-2 px-4">
                      <span className="text-red-500 text-xs font-medium">{popupQrError}</span>
                      <button
                        type="button"
                        onClick={() => { popupQrActiveRef.current = false; setPopupQrError(null); setPopupQrDataUrl(null); }}
                        className="text-xs text-indigo-600 underline"
                      >
                        Try again
                      </button>
                    </div>
                  ) : popupQrDataUrl ? (
                    <img src={popupQrDataUrl} alt="Payment QR" className="w-[200px] h-[200px]" />
                  ) : (
                    <span className="text-gray-400 text-xs">Initializing…</span>
                  )}
                </div>
                {!popupPaymentConfirmed && popupQrDataUrl && popupQrSourceId && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-3 h-3 border-2 border-gray-400 border-t-indigo-600 rounded-full animate-spin" />
                    Waiting for payment…
                  </div>
                )}
                <div className="text-sm font-semibold text-gray-700">{formatMoney(additionalFee, currency)}</div>
              </div>
            )}

            {/* Cash: operator confirm */}
            {paymentMethod === "cash" && (
              <div className="flex flex-col items-center text-center gap-3 py-2">
                <p className="text-sm text-gray-600">Accept cash and confirm only after the full amount is received.</p>
                <div className="text-3xl font-bold text-black">{formatMoney(additionalFee, currency)}</div>
                <p className="text-xs text-gray-400">An operator should confirm the payment before printing.</p>
                <button
                  onClick={() => confirmAndProceedFromPopup()}
                  disabled={isProcessingPayment}
                  className="w-full py-3 rounded-xl bg-black text-white font-semibold text-sm disabled:opacity-50"
                >
                  {isProcessingPayment ? "Processing…" : "Confirm payment received → Print"}
                </button>
              </div>
            )}

            {/* No provider configured fallback */}
            {!hasCashProvider && !hasGatewayProvider && (
              <div className="flex flex-col items-center gap-3 py-2">
                <p className="text-sm text-gray-500">No payment providers are configured. You can proceed directly.</p>
                <button
                  onClick={() => confirmAndProceedFromPopup()}
                  disabled={isProcessingPayment}
                  className="w-full py-3 rounded-xl bg-black text-white font-semibold text-sm disabled:opacity-50"
                >
                  {isProcessingPayment ? "Processing…" : "Print →"}
                </button>
              </div>
            )}

            {error && <div className="mt-3 text-sm text-red-500">{error}</div>}
          </motion.div>
        </div>
      )}
    </div >
  );
}

/* ---------- Unified PreviewTile (matches SlotEditor) ---------- */
function PreviewTile({ src, filter, transform }) {
  const containerRef = useRef(null);
  const imgRef = useRef(null);

  const userScale = transform?.scale ?? 1;
  const rawOffsetX = transform?.offsetX ?? 0;
  const rawOffsetY = transform?.offsetY ?? 0;

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!imgRef.current) return;
    const onload = () =>
      setImgSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    if (imgRef.current.complete) onload();
    else imgRef.current.addEventListener("load", onload);
    return () => imgRef.current?.removeEventListener?.("load", onload);
  }, [src]);

  function computeHeightFitScale(imgW, imgH, boxW, boxH) {
    if (!imgH || !boxH) return 1;
    return boxH / imgH;
  }

  function clampOffsetsPx(offsetX, offsetY, imgW, imgH, boxW, boxH, finalScale) {
    if (!imgW || !imgH || !boxW || !boxH) return { x: offsetX, y: offsetY };

    const dispW = imgW * finalScale;
    const dispH = imgH * finalScale;

    const maxX = Math.max(0, (dispW - boxW) / 2);
    const maxY = Math.max(0, (dispH - boxH) / 2);

    return {
      x: Math.min(Math.max(offsetX, -maxX), maxX),
      y: Math.min(Math.max(offsetY, -maxY), maxY),
    };
  }

  const baseScale = computeHeightFitScale(imgSize.w, imgSize.h, box.w, box.h);
  const finalScale = baseScale * userScale;

  const { x: renderX, y: renderY } = clampOffsetsPx(
    rawOffsetX,
    rawOffsetY,
    imgSize.w,
    imgSize.h,
    box.w,
    box.h,
    finalScale
  );

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black overflow-hidden">
      {!src && (
        <div className="absolute inset-0 flex items-center justify-center text-xs opacity-40">
          Empty
        </div>
      )}

      {src && (
        <img
          ref={imgRef}
          src={src}
          alt=""
          className="absolute top-1/2 left-1/2 pointer-events-none select-none max-w-none max-h-none"
          style={{
            width: imgSize.w,
            height: imgSize.h,
            transform: `
              translate(-50%, -50%)
              translate(${renderX}px, ${renderY}px)
              scale(${finalScale})
            `,
            transformOrigin: "center center",
            filter,
          }}
        />
      )}
    </div>
  );
}
