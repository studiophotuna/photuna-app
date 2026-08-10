
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import QRCode from "react-qr-code";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";
import { useLayout } from "../utils/useLayout";

/* ----------------------- Minimal i18n labels ----------------------- */
const LOCALES = {
  en: {
    printingTitle1: "We are now",
    printingTitle2: "Printing...",
    savedTitle1: "Your photos are",
    savedTitle2: "Ready!",
    thanks: "Thank you for choosing ",
    thanksBold: "Studio Photuna",
    thanksTail:
      " to create this special memory. To download your photos and GIF samples, simply scan the QR code.",
    remainingSuffix: "secs",
    qrFallback: "QR",
    posterFallback: "Poster",
    localSaved: "Your photos are saved locally by the booth operator.",
    tabletSaved: "Your session has been saved to your account.",
  },
  tl: {
    printingTitle1: "Kasalukuyan kaming",
    printingTitle2: "Nagpi-print...",
    savedTitle1: "Handa na ang",
    savedTitle2: "Iyong mga litrato!",
    thanks: "Salamat sa pagpili sa ",
    thanksBold: "Studio Photuna",
    thanksTail:
      " para lumikha ng espesyal na alaala. Para i-download ang iyong mga larawan at GIF, i-scan lang ang QR code.",
    remainingSuffix: "seg",
    qrFallback: "QR",
    posterFallback: "Poster",
    localSaved: "Naka-save ang mga larawan sa lokal na storage ng booth operator.",
    tabletSaved: "Na-save ang iyong session sa iyong account.",
  },
};
function resolveLocale(code) {
  const key = String(code ?? "en").toLowerCase();
  return LOCALES[key] ?? LOCALES.en;
}

/* ---------------------------- Appearance defaults ---------------------------- */
const DEFAULT_APPEARANCE = {
  boothName: "Studio Photuna",
  boothSlogan: "Ahead of the moment.",
  headerFont: "Ramillas",
  generalFont: "Interphases",
  buttonFont: "Interphases",
  headerFontColor: "#111827",
  generalFontColor: "#374151",
  bgColor: "#ffffff",
  buttonBgColor: "#2563eb",
  buttonHoverColor: "#1e40af",
  buttonFontColor: "#ffffff",
  logoPath: null,
  backgroundMediaPath: null,
};

export default function PrintPreviewScreen({
  seconds = 30,
  printingProgress,
  qrImage,
  qrUrl,
  composedImage,
  composedImagePath = null,
  composedImageUrl = null,
  sessionId = "default",
  eventId = "default",
  onPrintComplete,
  onNextPage,
  event = null,
  layout,
  printMode = "single",
  layoutConfig = null,
  photos = [],
  slotVideoMap = [],
  frameOverlayDataUrl = null,
  motionBackgroundColor = "#ffffff",
  tone = "normal",
  watermark = false,
  galleryEnabled = false,
  offlineMode = false,
  autoSaveTarget = "local",
  uploadMode = "system",
  operatorStorage = {},
  cloudStorage = {},
  eventName = "",
}) {
  // IMPORTANT: prefer window.api (preload exposes printPhoto here). Fall back to window.electron only if needed.
  const api =
    typeof window !== "undefined"
      ? window.api || window.electron || null
      : null;
  const { isPortrait, isUnsupported, isTablet } = useLayout();
  const isIpadApp = isTablet;

  /* ---------------------------- Load AdminDashboard state ---------------------------- */
  const [currentEvent, setCurrentEvent] = useState(event ?? null);
  const [globalAppearance, setGlobalAppearance] = useState(null);
  const [globalSettings, setGlobalSettings] = useState(null);

  const [isPreparing, setIsPreparing] = useState(true);
  const [resolvedQrUrl, setResolvedQrUrl] = useState(qrUrl || null);
  const [galleryError, setGalleryError] = useState("");
  const [localSavedPath, setLocalSavedPath] = useState(null);
  const [printError, setPrintError] = useState(null);

  useEffect(() => {
    setResolvedQrUrl(qrUrl || null);
  }, [qrUrl]);

  // Prop-driven print progress (if provided)
  const [printProgress, setPrintProgress] = useState(0);
  useEffect(() => {
    if (typeof printingProgress === "number") {
      const p = Math.max(0, Math.min(1, printingProgress));
      setPrintProgress(p);
      if (p >= 1) onPrintComplete?.();
    }
  }, [printingProgress, onPrintComplete]);

  useEffect(() => {
    let mounted = true;

    async function prepareGallery() {
      // uploadMode="none" or offline → skip all uploads
      if (!galleryEnabled || offlineMode || uploadMode === "none") {
        setResolvedQrUrl(null);
        setGalleryError("");
        if (offlineMode && composedImagePath) {
          setLocalSavedPath(composedImagePath);
        }
        setIsPreparing(false);
        return;
      }

      // uploadMode="operator" → POST to operator webhook
      if (uploadMode === "operator") {
        const { webhookUrl, apiKey } = operatorStorage;
        if (!webhookUrl) {
          setGalleryError("Operator storage URL is not configured.");
          setIsPreparing(false);
          return;
        }
        try {
          setIsPreparing(true);
          setGalleryError("");
          const src = composedImage || composedImageUrl || composedImagePath;
          const blob = src ? await fetch(src).then((r) => r.blob()) : null;
          if (!blob) throw new Error("No composed image available for upload.");
          const form = new FormData();
          form.append("image", blob, `photo-${sessionId}.png`);
          form.append("eventId", eventId);
          form.append("sessionId", sessionId);
          const headers = {};
          if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
          const res = await fetch(webhookUrl, { method: "POST", headers, body: form });
          if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
          if (mounted) setResolvedQrUrl(null);
        } catch (err) {
          console.error("[StorageChoice] operator upload failed:", err);
          if (mounted) setGalleryError(err?.message || "Upload to your storage failed.");
        } finally {
          if (mounted) setIsPreparing(false);
        }
        return;
      }

      // uploadMode="google-drive" or "dropbox" → cloud:upload IPC
      if (uploadMode === "google-drive" || uploadMode === "dropbox") {
        try {
          setIsPreparing(true);
          setGalleryError("");
          const result = await api?.cloudUpload?.({
            provider: uploadMode,
            composedImageDataUrl: composedImage || null,
            composedImagePath: composedImagePath || null,
            filename: `photo-${sessionId}-${Date.now()}.png`,
            eventName: eventName || "Event",
            boothName: boothName || "",
            sessionId,
          });
          if (!result?.ok) throw new Error(result?.error || "Upload failed");
          if (mounted) setResolvedQrUrl(null);
        } catch (err) {
          console.error("[StorageChoice] cloud upload failed:", err);
          if (mounted) setGalleryError(err?.message || `Upload to ${uploadMode === "google-drive" ? "Google Drive" : "Dropbox"} failed.`);
        } finally {
          if (mounted) setIsPreparing(false);
        }
        return;
      }

      // uploadMode="system" (default) → Photuna Supabase gallery
      try {
        setIsPreparing(true);
        setGalleryError("");

        const result = await api?.createOnlineGallery?.({
          composedImage,
          composedImagePath,
          composedImageUrl,
          photos,
          layout,
          layoutConfig,
          slotVideoMap,
          frameOverlayDataUrl,
          motionBackgroundColor,
          tone,
          watermark,
          galleryEnabled,
          sessionId,
          eventId,
        });

        if (!mounted) return;

        if (!result?.ok) {
          throw new Error(result?.error || "Gallery creation failed");
        }

        if (result?.qrUrl) {
          setResolvedQrUrl(result.qrUrl);
        }

      } catch (err) {
        console.error("Gallery creation failed:", err);
        if (mounted) {
          setGalleryError(err?.message || "Gallery upload failed");
        }
      } finally {
        if (mounted) setIsPreparing(false);
      }
    }

    prepareGallery();

    return () => {
      mounted = false;
    };
  }, [
    api,
    composedImage,
    composedImagePath,
    composedImageUrl,
    photos,
    layout,
    layoutConfig,
    slotVideoMap,
    frameOverlayDataUrl,
    motionBackgroundColor,
    tone,
    watermark,
    galleryEnabled,
    sessionId,
    eventId,
    uploadMode,
    operatorStorage,
  ]);

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
        if (event) {
          setCurrentEvent(event);
        } else {
          const evts = await api.getEvents?.();
          if (Array.isArray(evts)) {
            const curId = await api.getCurrentEventId?.();
            const found = evts.find((e) => e?.id === curId);
            if (found) setCurrentEvent(found);
          }
        }
      } catch (err) {
        console.warn("PrintPreviewScreen: failed to load appearance/settings/event:", err);
      }
    })();
  }, [api, event]);

  /* ---------------------------- Appearance resolution ---------------------------- */
  const appearance = useMemo(() => {
    const evApp = currentEvent?.appearance ?? {};
    const gApp = globalAppearance ?? {};
    const merged = { ...DEFAULT_APPEARANCE, ...gApp, ...evApp };
    return {
      ...merged,
      logoPath: merged.logoPath ? normalizeToFileUrl(merged.logoPath) : null,
      backgroundMediaPath: merged.backgroundMediaPath ? normalizeToFileUrl(merged.backgroundMediaPath) : null,
    };
  }, [currentEvent, globalAppearance]);

  const {
    boothName,
    headerFont,
    generalFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    buttonBgColor,
    buttonFont,
    buttonFontColor,
    logoPath,
    logoSize,
  } = appearance;
  const logoScale = (logoSize ?? 100) / 100;

  // Load fonts
  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
  }, [headerFont, generalFont]);

  /* ---------------------------- Language ---------------------------- */
  const langCode = currentEvent?.settings?.language ?? globalSettings?.language ?? "en";
  const i18n = resolveLocale(langCode);

  // ---------------------------- Timer resolution ----------------------------
  const printingSeconds =
    currentEvent?.settings?.screenTimers?.printing ??
    globalSettings?.screenTimers?.printing ??
    seconds;

  // Page timer progress (for left countdown only)
  const [pageProgress, setPageProgress] = useState(0);

  // If your shell can push real-time progress, subscribe here.
  // We'll try window.api.onPrintProgress((0..1)) if available.
  useEffect(() => {
    if (!api?.onPrintProgress) return;
    const off = api.onPrintProgress((value) => {
      const p = Math.max(0, Math.min(1, Number(value) || 0));
      setPrintProgress(p);
      if (p >= 1) onPrintComplete?.();
    });
    return () => {
      try { off?.(); } catch { }
    };
  }, [api, onPrintComplete]);

  // Fallback page timer (only for the left side countdown). Does NOT drive the poster reveal anymore.
  useEffect(() => {
    if (isPreparing) {
      setPageProgress(0);
      return;
    }

    let current = 0;

    const interval = setInterval(() => {
      current += 1;
      const p = Math.min(1, current / printingSeconds);
      setPageProgress(p);
    }, 1000);

    return () => clearInterval(interval);
  }, [printingSeconds, isPreparing]);

  // Right-side reveal uses printer progress if available; if the host doesn't send it,
  // mirror the page timer so things still move.
  useEffect(() => {
    if (!api?.onPrintProgress) {
      setPrintProgress(pageProgress);
    }
  }, [api, pageProgress]);

  // For the clip-path animation on the right
  const posterBottomInset = Math.max(0, (1 - printProgress) * 100);

  /* ---------------------------- Normalized sources ---------------------------- */
  const qrSrc = useMemo(() => normalizeToFileUrl(qrImage), [qrImage]);
  const posterSrc = useMemo(() => normalizeToFileUrl(composedImage), [composedImage]);

  const [posterDims, setPosterDims] = useState({ w: 0, h: 0 });
  const posterRatio = useMemo(() => {
    const { w, h } = posterDims;
    return w > 0 && h > 0 ? w / h : null;
  }, [posterDims]);

  const resolvedLayout = layout || "4x6";

  const isStripTall = resolvedLayout === "2x6";
  const isStripWide = resolvedLayout === "6x2";
  const isSheetPortrait = resolvedLayout === "4x6";
  const isSheetLandscape = resolvedLayout === "6x4";

  const isStripLayout = isStripTall || isStripWide;

  // temporary: use posterSrc until you create a real single-strip asset
  const stripSrc = posterSrc;

  const activePreviewSrc = isStripLayout ? stripSrc : posterSrc;

  const previewBottomInset =
    typeof posterBottomInset !== "undefined"
      ? posterBottomInset
      : Math.max(0, 100 - printProgress * 100);

  /* ---------------------------- PRINT: single-shot, robust ---------------------------- */
  const printedRef = useRef(false);
  const ipadPrintedRef = useRef(false);

  const sendPrintJob = useCallback(async () => {
    if (printedRef.current) return; // avoid duplicates
    if (!api) { console.warn("Print API not available"); return; }
    if (!composedImage || typeof composedImage !== "string" || !composedImage.startsWith("data:")) {
      console.warn("No valid composedImage data URL to print");
      return;
    }
    try {
      const settings = await api.getSettings?.();
      const list = await api.getPrinters?.() || [];
      const effectiveSettings = {
        ...(settings || {}),
        ...(currentEvent?.settings || {}),
      };
      const pickBy = (name) =>
        list.find(p => p?.name === name || p?.displayName === name);

      // Try the saved printer first
      let target = effectiveSettings?.selectedPrinter
        ? pickBy(effectiveSettings.selectedPrinter)
        : null;
      // Else default, else first available
      if (!target) target = list.find(p => p.isDefault) || list[0] || null;

      if (!target) {
        setPrintError("No printer detected. Check that your printer is on and the driver is installed.");
        return;
      }
      // Persist the resolved name if it changed (keeps Settings in sync)
      if (effectiveSettings?.selectedPrinter !== target.name) {
        await api.setSettings?.({ ...(settings || {}), selectedPrinter: target.name });
      }

      await api.savePrintCopy?.({
        imageData: posterSrc,
        eventId,
        sessionId: sessionId || "default",
        filename: `print_copy_${Date.now()}.png`,
      });

      const res = await api.printPhoto?.({
        printer: String(target.name),
        imageData: posterSrc,
        layout: resolvedLayout || "4x6",
        printMode: printMode ?? "single",
        paperSize: effectiveSettings?.paperSize || resolvedLayout || "4x6",
        copies: effectiveSettings?.printCopies ?? 1,
        colorMode: effectiveSettings?.printColorMode ?? "color",
        quality: effectiveSettings?.printQuality ?? "high",
        orientation: effectiveSettings?.printOrientation ?? "auto",
        duplexMode: effectiveSettings?.printDuplexMode ?? "simplex",
        dpi: effectiveSettings?.printDpi ?? 300,
        usePrinterDefaults: effectiveSettings?.usePrinterDefaults ?? false,
      });

      if (!res || res.ok === false) {
        setPrintError(res?.error ?? "Print job failed. Please check your printer and try again.");
        return;
      }

      printedRef.current = true;
    } catch (err) {
      setPrintError(err?.message ?? "An unexpected error occurred while printing.");
    }
  }, [api, composedImage, currentEvent, resolvedLayout, posterSrc, eventId, sessionId]);

  // iPad: trigger native AirPrint dialog via window.print() with an injected @media print layout
  const handleIpadPrint = useCallback(async () => {
    const src = composedImage || composedImageUrl;
    if (!src) return;

    let blobUrl = null;
    let styleEl = null;
    let printEl = null;

    const cleanup = () => {
      window.onafterprint = null;
      try { styleEl && document.head.removeChild(styleEl); } catch {}
      try { printEl && document.body.removeChild(printEl); } catch {}
      if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    };

    try {
      const blob = await fetch(src).then(r => r.blob());
      blobUrl = URL.createObjectURL(blob);

      styleEl = document.createElement('style');
      styleEl.textContent = `@media print {
        body > #root { display: none !important; }
        body > #photuna-print-root { display: flex !important; position: fixed; inset: 0; background: #fff; align-items: center; justify-content: center; }
        body > #photuna-print-root img { max-width: 100%; max-height: 100%; object-fit: contain; }
        @page { margin: 0; size: auto; }
      }`;
      document.head.appendChild(styleEl);

      printEl = document.createElement('div');
      printEl.id = 'photuna-print-root';
      printEl.style.display = 'none';
      const img = document.createElement('img');
      img.src = blobUrl;
      img.onerror = () => { cleanup(); setPrintError('Could not load image for printing.'); };
      img.onload = () => {
        window.onafterprint = cleanup;
        setTimeout(cleanup, 30000);
        window.print();
      };
      printEl.appendChild(img);
      document.body.appendChild(printEl);

    } catch (err) {
      cleanup();
      if (err?.name !== 'AbortError') setPrintError('Could not open print dialog. Try again.');
    }
  }, [composedImage, composedImageUrl]);

  // Send the job as soon as the composed image is present on the Print screen
  useEffect(() => {
    if (
      typeof composedImage === "string" &&
      composedImage.startsWith("data:image") &&
      composedImage.length > 20000
    ) {
      sendPrintJob();
    }
  }, [composedImage, sendPrintJob]);

  // On iPad (Capacitor), auto-print for print-only mode
  useEffect(() => {
    if (
      isIpadApp &&
      uploadMode === "none" &&
      !ipadPrintedRef.current &&
      (composedImage || composedImageUrl)
    ) {
      ipadPrintedRef.current = true;
      handleIpadPrint();
    }
  }, [isTablet, uploadMode, composedImage, composedImageUrl, handleIpadPrint]);

  // Navigate to next page once the page timer hits zero (do NOT print again here)
  useEffect(() => {
    if (!isPreparing && pageProgress >= 1) {
      onNextPage?.();
    }
  }, [pageProgress, onNextPage, isPreparing]);

  /* ---------------------------- Preview aspect styles ---------------------------- */
  const ASPECT_STYLES = {
    "2x6": { aspectRatio: "2 / 6" },
    "4x6": { aspectRatio: "4 / 6" },
    "6x4": { aspectRatio: "6 / 4" },
    "6x2": { aspectRatio: "6 / 2" },
  };

  // Base container sizes (visual only, not print DPI):
  const SIZE_STYLES = {
    "2x6": { width: 240 }, // render two copies side-by-side
    "6x2": { width: 240 }, // render two copies stacked
    "4x6": { width: 820 }, // single portrait sheet
    "6x4": { width: 920 }, // single landscape sheet
  };

  const aspectStyle = ASPECT_STYLES[resolvedLayout] ?? ASPECT_STYLES["4x6"];
  const { width: baseW } = SIZE_STYLES[resolvedLayout] ?? SIZE_STYLES["4x6"];
  const scale = 1; // default preview scale (tune per layout if desired)

  // Use the actual image aspect once we know it; otherwise fall back to the layout hint
  const dynamicAspectStyle = useMemo(() => {
    const { w, h } = posterDims ?? {};
    if (w > 0 && h > 0) {
      return { aspectRatio: `${w} / ${h}` };
    }
    return aspectStyle; // fallback (2x6 / 4x6 / 6x4 / 6x2)
  }, [posterDims, aspectStyle]);

  // Left-side remaining time
  const remaining = Math.max(0, printingSeconds - Math.floor(pageProgress * printingSeconds));

  if (isUnsupported) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center text-center gap-6" style={{ backgroundColor: bgColor }}>
        <p style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(22px, 3vw, 56px)', fontWeight: 'bold' }}>Display Not Supported</p>
        <p style={{ fontFamily: generalFont, color: generalFontColor, fontSize: 'clamp(14px, 1.8vw, 34px)' }}>Minimum resolution: 1080 × 1920 (Full HD portrait)</p>
      </div>
    );
  }

  if ((galleryEnabled || uploadMode === "operator" || uploadMode === "google-drive" || uploadMode === "dropbox") && isPreparing) {
    const preparingLabel = uploadMode === "operator"
      ? `Sending to ${operatorStorage?.label || "your storage"}…`
      : uploadMode === "google-drive" ? "Saving to Google Drive…"
      : uploadMode === "dropbox"      ? "Saving to Dropbox…"
      : "Preparing your gallery";
    const preparingSub = uploadMode === "operator"
      ? "Uploading your photos to your storage destination."
      : (uploadMode === "google-drive" || uploadMode === "dropbox")
      ? "Uploading your photo to your cloud storage."
      : "Generating your QR code and getting your photos ready.";

    return (
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden px-10"
        style={{
          backgroundColor: bgColor,
          color: generalFontColor,
          fontFamily: generalFont,
        }}
      >
        <div className="flex flex-col items-center justify-center text-center">
          <p
            className="font-semibold leading-none"
            style={{
              color: headerFontColor,
              fontFamily: headerFont,
              fontSize: 'clamp(28px, 5vw, 80px)',
            }}
          >
            {preparingLabel}
          </p>

          <p className="mt-5 leading-relaxed max-w-2xl" style={{ fontSize: 'clamp(14px, 2vw, 28px)' }}>
            {preparingSub}
          </p>

          <div className="mt-10 flex items-center gap-3">
            <span
              className="w-3 h-3 rounded-full animate-bounce"
              style={{ backgroundColor: headerFontColor, animationDelay: "0ms" }}
            />
            <span
              className="w-3 h-3 rounded-full animate-bounce"
              style={{ backgroundColor: headerFontColor, animationDelay: "150ms" }}
            />
            <span
              className="w-3 h-3 rounded-full animate-bounce"
              style={{ backgroundColor: headerFontColor, animationDelay: "300ms" }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full h-full flex ${isPortrait ? "flex-col" : "flex-row"} overflow-hidden`}
      style={{
        backgroundColor: bgColor,
        color: generalFontColor,
        fontFamily: generalFont,
      }}
    >

      {/* Portrait Row 1: logo + timer */}
      {isPortrait && (
        <div className="shrink-0 flex items-center justify-between" style={{ padding: '2vh 4vw' }}>
          {logoPath
            ? <img src={logoPath} alt="logo" style={{ maxHeight: `${Math.round(60 * logoScale)}px` }} className="w-auto object-contain" />
            : <span className="font-bold" style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(18px, 2.5vw, 46px)' }}>{boothName}</span>
          }
          <div className="px-5 py-2 rounded-full font-bold shadow-sm" style={{ backgroundColor: buttonBgColor, color: buttonFontColor, fontFamily: generalFont, fontSize: 'clamp(16px, 2vw, 38px)' }} aria-live="polite">
            {Math.max(0, remaining)}s
          </div>
        </div>
      )}

      {/* INFO PANEL — portrait: Row 3 (shrink-0, h-[45vh], order 2); landscape: left column 50% */}
      <div
        className={isPortrait
          ? "shrink-0 overflow-y-auto flex flex-col items-center justify-start"
          : "flex flex-col justify-center items-center w-1/2 px-10"
        }
        style={isPortrait ? { height: '45vh', padding: '1vh 4vw 2vh', order: 2 } : undefined}
      >
        {/* Landscape: timer pill */}
        {!isPortrait && (
          <div
            className="rounded-full font-bold shadow-sm mb-10"
            style={{ fontFamily: generalFont, backgroundColor: buttonBgColor, color: buttonFontColor, fontSize: 'clamp(14px, 1.8vw, 26px)', padding: 'clamp(6px, 0.8vh, 12px) clamp(14px, 1.8vw, 28px)' }}
            aria-live="polite"
          >
            {Math.max(0, remaining)}s
          </div>
        )}

        <div className="text-center" style={{ fontFamily: headerFont }}>
          <p style={{ color: headerFontColor, fontSize: isPortrait ? 'clamp(22px, 3vw, 56px)' : 'clamp(32px, 5vw, 80px)' }}>
            {isIpadApp
              ? (uploadMode === "google-drive" ? "Saved to"
                : uploadMode === "dropbox" ? "Saved to"
                : uploadMode === "none" ? "Print is"
                : i18n.savedTitle1)
              : i18n.printingTitle1}
          </p>
          <p className="italic font-semibold -mt-2" style={{ color: headerFontColor, fontSize: isPortrait ? 'clamp(22px, 3vw, 56px)' : 'clamp(32px, 5vw, 80px)' }}>
            {isIpadApp
              ? (uploadMode === "google-drive" ? "Google Drive"
                : uploadMode === "dropbox" ? "Dropbox"
                : uploadMode === "none" ? "on its way!"
                : i18n.savedTitle2)
              : i18n.printingTitle2}
          </p>
        </div>

        {/* QR code — system gallery mode only */}
        {galleryEnabled && !offlineMode && uploadMode === "system" && (
          <div className="mt-6 border rounded-xl p-4 bg-white text-black border-black">
            {resolvedQrUrl ? (
              <div className="bg-white p-2 rounded-lg">
                <QRCode value={resolvedQrUrl} size={isPortrait ? 180 : 256} bgColor="#ffffff" fgColor="#000000" />
              </div>
            ) : qrSrc ? (
              <img src={qrSrc} alt="QR" className="object-contain bg-gray-100 rounded-lg" style={{ width: isPortrait ? 180 : 256, height: isPortrait ? 180 : 256 }} />
            ) : (
              <div className="flex items-center justify-center text-gray-400 bg-gray-100 rounded-lg" style={{ width: isPortrait ? 180 : 256, height: isPortrait ? 180 : 256 }}>
                {isPreparing ? "Preparing" : i18n.qrFallback}
              </div>
            )}
            {galleryError && (
              <div className="mt-2 text-center text-xs text-red-600">Gallery upload failed</div>
            )}
          </div>
        )}

        {/* Operator / cloud storage result */}
        {(uploadMode === "operator" || uploadMode === "google-drive" || uploadMode === "dropbox") && !isPreparing && (
          <div className="mt-6 rounded-xl p-4 text-center" style={{ background: `rgba(255,255,255,0.08)` }}>
            {galleryError ? (
              <p className="text-sm" style={{ color: "#ef4444" }}>{galleryError}</p>
            ) : (
              <p className="text-sm font-medium" style={{ color: generalFontColor }}>
                ✓ Saved to {uploadMode === "google-drive" ? "Google Drive" : uploadMode === "dropbox" ? "Dropbox" : (operatorStorage?.label || "your storage")}
              </p>
            )}
          </div>
        )}

        {/* Thank you copy */}
        <p
          className="text-center mt-6 leading-relaxed"
          style={{ fontFamily: generalFont, color: generalFontColor, fontSize: 'clamp(12px, 1.5vw, 26px)', maxWidth: '36rem' }}
        >
          {i18n.thanks}
          <span className="font-semibold" style={{ color: headerFontColor }}>
            {boothName ?? i18n.thanksBold}
          </span>
          {galleryEnabled && !offlineMode && uploadMode === "system"
            ? i18n.thanksTail
            : uploadMode === "google-drive"
            ? " for creating this special memory. Your photo has been saved to Google Drive and printed locally — collect your print at the counter."
            : uploadMode === "dropbox"
            ? " for creating this special memory. Your photo has been saved to Dropbox and printed locally — collect your print at the counter."
            : uploadMode === "none"
            ? " for creating this special memory. Your photo has been printed — collect your print at the counter."
            : ` ${isIpadApp ? i18n.tabletSaved : i18n.localSaved}`}
        </p>

        {/* Print error banner */}
        {printError && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-center text-sm text-red-700 max-w-sm">
            {printError}
          </div>
        )}
      </div>

      {/* POSTER PREVIEW — portrait: Row 2 (flex-1 min-h-0, order 1); landscape: right column 50% */}
      <div
        className={isPortrait
          ? "flex-1 min-h-0 flex items-center justify-center overflow-hidden"
          : "w-1/2 flex items-center justify-center p-6"
        }
        style={isPortrait ? { padding: '1vh 4vw', order: 1 } : undefined}
      >
        <div className="w-full h-full flex items-center justify-center">
          {isStripTall ? (
            /* 2×6: show single strip only */
            <div
              className="relative overflow-hidden"
              style={{
                ...dynamicAspectStyle,
                maxWidth: "100%",
                maxHeight: "100%",
                width: "clamp(360px, 90%, 100%)",
              }}
            >
              {posterSrc ? (
                <>
                  <motion.img
                    src={posterSrc}
                    alt="2x6 Strip"
                    className="absolute inset-0 w-full h-full object-contain"
                    initial={{ clipPath: "inset(0 0 100% 0)" }}
                    animate={{ clipPath: `inset(0 0 ${posterBottomInset}% 0)` }}
                    transition={{ duration: 0.85, ease: "easeOut" }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setPosterDims({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                  />
                  {printProgress < 1 && (
                    <motion.div
                      className="absolute left-0 w-full h-8 pointer-events-none"
                      style={{
                        top: `${printProgress * 100}%`,
                        transform: "translateY(-50%)",
                        background:
                          "linear-gradient(to bottom, rgba(236,72,153,0), rgba(236,72,153,0.22), rgba(236,72,153,0))",
                      }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25 }}
                    />
                  )}
                  {printProgress >= 1 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.6 }}
                      transition={{ duration: 0.4 }}
                      className="absolute inset-0 pointer-events-none"
                      style={{ boxShadow: "0 0 40px rgba(236,72,153,0.35)" }}
                    />
                  )}
                </>
              ) : (
                <div className="absolute inset-0 w-full h-full flex items-center justify-center text-gray-400 bg-gray-100">
                  {i18n.posterFallback}
                </div>
              )}
            </div>
          ) : isStripWide ? (
            /* 6×2: show single strip only */
            <div
              className="relative overflow-hidden"
              style={{
                ...dynamicAspectStyle,
                maxWidth: "100%",
                maxHeight: "100%",
                width: "clamp(480px, 95%, 100%)",
              }}
            >
              {posterSrc ? (
                <>
                  <motion.img
                    src={posterSrc}
                    alt="6x2 Strip"
                    className="absolute inset-0 w-full h-full object-contain"
                    initial={{ clipPath: "inset(0 0 100% 0)" }}
                    animate={{ clipPath: `inset(0 0 ${posterBottomInset}% 0)` }}
                    transition={{ duration: 0.85, ease: "easeOut" }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setPosterDims({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                  />
                  {printProgress < 1 && (
                    <motion.div
                      className="absolute left-0 w-full h-8 pointer-events-none"
                      style={{
                        top: `${printProgress * 100}%`,
                        transform: "translateY(-50%)",
                        background:
                          "linear-gradient(to bottom, rgba(236,72,153,0), rgba(236,72,153,0.22), rgba(236,72,153,0))",
                      }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25 }}
                    />
                  )}
                  {printProgress >= 1 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.6 }}
                      transition={{ duration: 0.4 }}
                      className="absolute inset-0 pointer-events-none"
                      style={{ boxShadow: "0 0 40px rgba(236,72,153,0.35)" }}
                    />
                  )}
                </>
              ) : (
                <div className="absolute inset-0 w-full h-full flex items-center justify-center text-gray-400 bg-gray-100">
                  {i18n.posterFallback}
                </div>
              )}
            </div>
          ) : (
            /* 4×6 or 6×4: single sheet */
            <div
              className="relative overflow-hidden"
              style={{
                ...dynamicAspectStyle,
                width: isSheetPortrait ? "clamp(360px, 90%, 100%)" : "clamp(480px, 95%, 100%)",
                maxWidth: "100%",
                maxHeight: "100%",
                height: "auto",
              }}
            >
              {posterSrc ? (
                <>
                  <motion.img
                    src={posterSrc}
                    alt="Poster"
                    className="absolute inset-0 w-full h-full object-contain"
                    initial={{ clipPath: "inset(0 0 100% 0)" }}
                    animate={{ clipPath: `inset(0 0 ${posterBottomInset}% 0)` }}
                    transition={{ duration: 0.85, ease: "easeOut" }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setPosterDims({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                  />
                  {printProgress < 1 && (
                    <motion.div
                      className="absolute left-0 w-full h-10 pointer-events-none"
                      style={{
                        top: `${printProgress * 100}%`,
                        transform: "translateY(-50%)",
                        background:
                          "linear-gradient(to bottom, rgba(236,72,153,0), rgba(236,72,153,0.22), rgba(236,72,153,0))",
                      }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25 }}
                    />
                  )}
                  {printProgress >= 1 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.6 }}
                      transition={{ duration: 0.4 }}
                      className="absolute inset-0 pointer-events-none"
                      style={{ boxShadow: "0 0 60px rgba(236,72,153,0.35)" }}
                    />
                  )}
                </>
              ) : (
                <div className="absolute inset-0 w-full h-full flex items-center justify-center text-gray-400 bg-gray-100">
                  {i18n.posterFallback}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div >
  );
}
