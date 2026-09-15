
// src/components/TemplateScreen.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";
import { getBridge } from "../utils/bridge";
import { useLayout } from "../utils/useLayout";
import { boothTheme, BoothTopBar, BoothTimer, TYPE, SCREEN_MOTION, logoOnEveryScreen } from "../components/booth/boothUi";
import useUsbLiveView from "../hooks/useUsbLiveView";
import { isUsbLiveViewSupported } from "../services/usbLiveView";

/* --------------------------- Responsive SVG icons --------------------------- */
const PhotoStripVertical = () => (
  <svg
    className="w-full max-w-[120px] sm:max-w-[140px] md:max-w-[160px]"
    viewBox="0 0 80 150"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="6" y="6" width="68" height="138" rx="8" stroke="#000" strokeWidth="4" fill="#fff" />
    <rect x="16" y="18" width="48" height="30" rx="3" fill="#e5e5e5" />
    <rect x="16" y="56" width="48" height="30" rx="3" fill="#e5e5e5" />
    <rect x="16" y="94" width="48" height="30" rx="3" fill="#e5e5e5" />
  </svg>
);

const PhotoStripHorizontal = () => (
  <svg
    className="w-full max-w-[140px] sm:max-w-[160px] md:max-w-[180px]"
    viewBox="0 0 180 80"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="6" y="6" width="168" height="68" rx="8" stroke="#000" strokeWidth="4" fill="#fff" />
    <rect x="18" y="14" width="36" height="52" rx="3" fill="#e5e5e5" />
    <rect x="62" y="14" width="36" height="52" rx="3" fill="#e5e5e5" />
    <rect x="106" y="14" width="36" height="52" rx="3" fill="#e5e5e5" />
  </svg>
);

const PostcardSquare = () => (
  <svg
    className="w-full max-w-[140px] sm:max-w-[160px] md:max-w-[180px]"
    viewBox="0 0 140 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="6" y="6" width="128" height="108" rx="8" stroke="#000" strokeWidth="4" fill="#fff" />
    <rect x="18" y="18" width="92" height="84" rx="4" fill="#e5e5e5" />
  </svg>
);

const PostcardLandscape = () => (
  <svg
    className="w-full max-w-[160px] sm:max-w-[180px] md:max-w-[200px]"
    viewBox="0 0 160 110"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="6" y="6" width="148" height="98" rx="8" stroke="#000" strokeWidth="4" fill="#fff" />
    <rect x="16" y="18" width="120" height="72" rx="4" fill="#e5e5e5" />
  </svg>
);

/** Two-up strip preview: supports vertical (2x6) and horizontal (6x2) */
function TwoUpStrip({
  src,
  alt = "strip",
  orientation = "2x6",          // ✅ real default; do NOT use "2x6" || "6x2"
  size = 300,                    // main dimension in px (height for 2x6, width for 6x2)
  rotatePrimary = 0,
  rotateDuplicate = 30,          // rotation in degrees for the slanted copy (15 looks nice for 6x2)
  className = "",
}) {
  const key = String(orientation).toLowerCase();
  const isVertical = key === "2x6"; // true for 2x6, false for 6x2

  // Container uses height for vertical, width for horizontal
  const containerStyle = isVertical
    ? { height: `${size}px`, width: "100%" }
    : { width: `${size}px`, height: "100%" };

  // Shared base classes for the images
  // Thin edge, no heavy shadow (booth premium style).
  const baseImg = "border border-black/10";

  return (
    <div className={`relative w-full h-[350px] pointer-events-none ${className}`}>
      <div className="relative" style={containerStyle}>
        {/* Primary strip (centered) */}
        <img
          src={src}
          alt={alt}
          className={`${baseImg} ${isVertical ? "h-[350px]" : "w-[350px]"} ${isVertical ? "absolute left-1/2 -translate-x-1/2" : "absolute left-1/2 top-1/2 -translate-x-1/2"
            }`}
          style={{
            transformOrigin: "left center",
          }}
        />

        {/* Duplicate strip (slanted) */}
        <img
          src={src}
          alt={`${alt} (duplicate)`}
          className={`${baseImg} ${isVertical ? "h-[350px]" : "w-[350px]"} ${isVertical ? "" : "absolute bottom-1/2"}`}
          style={{
            transform: `rotate(${isVertical ? rotateDuplicate : 30}deg)`,
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------ Helpers & defaults ------------------------------ */

const DEFAULT_PLACEHOLDERS = [
  { id: "photoVertical", name: "Photo Strips", icon: <PhotoStripVertical /> },
  { id: "photoHorizontal", name: "Photo Strips Horizontal", icon: <PhotoStripHorizontal /> },
  { id: "postcardSquare", name: "Postcards", icon: <PostcardSquare /> },
  { id: "postcardLandscape", name: "Postcards Landscape", icon: <PostcardLandscape /> },
];

const DEFAULT_APPEARANCE = {
  boothName: "Studio Photuna",
  boothSlogan: "Ahead of the moment.",
  headerFont: "Ramillas",
  generalFont: "Interphases",
  headerFontColor: "#111827",
  generalFontColor: "#374151",
  bgColor: "#ffffff",
  logoPath: null,
  backgroundMediaPath: null,
  backgroundType: "media",
  buttonBgColor: "#2563eb",
  buttonHoverColor: "#1e40af",
  buttonFont: "Interphases",
  buttonFontColor: "#ffffff",
};

const DEFAULT_TIMERS = {
  template: 50,
};

/* ------------------------------ Minimal i18n ------------------------------ */
const LOCALES = {
  en: {
    choose: "Choose",
    your: "your",
    template: "Template",
    descBusiness:
      "After you’ve selected your perfect template, the next step is quick and easy—heading over to the payment section to secure your choice.",
    descRental:
      "After you’ve selected your template, we’ll jump straight to the camera.",
    secondsSuffix: "s",
  },
  tl: {
    choose: "Pumili",
    your: "ng iyong",
    template: "Template",
    descBusiness:
      "Pagkapili ng template, mabilis ang susunod—diretso sa bayad.",
    descRental:
      "Pagkapili ng template, derecho na tayo sa camera.",
    secondsSuffix: "seg",
  },
};
function resolveLocale(code) {
  if (!code) return LOCALES.en;
  const key = String(code).toLowerCase();
  return LOCALES[key] || LOCALES.en;
}

function withCacheBust(url, version) {
  if (!url) return url;
  // Data URLs don’t need cache busting
  if (typeof url === "string" && url.startsWith("data:")) return url;

  try {
    // Ensure we have a proper URL (works for file:// and http(s)://)
    const u = new URL(url);
    u.searchParams.set("v", String(version ?? Date.now()));
    return u.toString();
  } catch {
    // Fallback for raw file paths that slipped past normalizeToFileUrl
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${version ?? Date.now()}`;
  }
}

/* -------------------------------- Component -------------------------------- */
export default function TemplateScreen({
  templates = [],
  event = null,
  eventId = null,
  eventConfig = null,
  onSelect = () => { },
  onApplyTemplate = null,
  onCancel = () => { },
  defaultTimer = DEFAULT_TIMERS.template,
  cameraStreamRef = null,
}) {
  const api = getBridge();
  const { isPortrait, isUnsupported, isTablet } = useLayout();

  /* ---------- Load global fallbacks when no event prop is passed ---------- */
  const [globalAppearance, setGlobalAppearance] = useState(null);
  const [globalSettings, setGlobalSettings] = useState(null);
  const [loadedEvent, setLoadedEvent] = useState(event ?? null);

  const [activeIndex, setActiveIndex] = useState(0);
  const [itemsPerView, setItemsPerView] = useState(4);

  // Photo source "usb": keep the USB camera's live view running while the guest picks
  // a template, so the photo screen's preview appears at once.
  const usbCameraSelected = isUsbLiveViewSupported()
    && (globalSettings?.cameraSource ?? event?.settings?.cameraSource) === "usb";
  useUsbLiveView(usbCameraSelected, null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!api) return;
        // Load event by id if not provided
        if (!event && eventId && api.getEvents) {
          const all = await api.getEvents();
          const found = Array.isArray(all)
            ? all.find((e) => String(e.id) === String(eventId))
            : null;
          if (mounted && found) setLoadedEvent(found);
        }
        // Global appearance/settings as fallback
        if (api.getAppearance) {
          const a = await api.getAppearance();
          if (mounted) setGlobalAppearance(a ?? null);
        }
        if (api.getSettings) {
          const s = await api.getSettings();
          if (mounted) setGlobalSettings(s ?? null);
        }
      } catch (err) {
        console.warn("TemplateScreen: load fallbacks failed", err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [api, event, eventId]);

  useEffect(() => {
    let mounted = true;

    const preloadCamera = async () => {
      try {
        if (cameraStreamRef?.current ?? window.__cameraStream) return;
        // The USB camera's live view is the preview; the photo screen opens the webcam
        // itself only if that live view is unavailable.
        if (event?.settings?.cameraSource === "usb" && isUsbLiveViewSupported()) return;

        const deviceId = event?.settings?.selectedCameraId;
        const videoConstraints = deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { width: { ideal: 1920 }, height: { ideal: 1080 } };

        const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });

        if (!mounted) return;

        if (cameraStreamRef) cameraStreamRef.current = stream;
        window.__cameraStream = stream;
      } catch (err) {
        console.warn("Camera preload failed:", err);
      }
    };

    preloadCamera();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const updateItemsPerView = () => {
      const width = window.innerWidth;

      if (width >= 1280) setItemsPerView(4); // desktop
      else if (width >= 768) setItemsPerView(2);
      else setItemsPerView(1);
    };

    updateItemsPerView();
    window.addEventListener("resize", updateItemsPerView);

    return () => window.removeEventListener("resize", updateItemsPerView);
  }, []);

  const currentEvent = loadedEvent ?? event ?? null;

  /* ------------------------------ Resolve appearance ------------------------------ */
  const cfg = currentEvent?.config ?? eventConfig ?? {};
  const appearance = useMemo(() => {
    const evApp = currentEvent?.appearance ?? {};
    const gApp = globalAppearance ?? {};
    const merged = { ...DEFAULT_APPEARANCE, ...gApp, ...evApp };
    return {
      ...merged,
      logoPath: merged.logoPath ? normalizeToFileUrl(merged.logoPath) : null,
      backgroundMediaPath: merged.backgroundMediaPath
        ? normalizeToFileUrl(merged.backgroundMediaPath)
        : null,
      boothName: evApp.boothName ?? gApp.boothName ?? cfg?.eventName ?? "Event",
    };
  }, [currentEvent, globalAppearance, cfg?.eventName]);

  const {
    logoPath,
    backgroundMediaPath,
    boothSlogan,
    boothName,
    headerFont,
    generalFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    buttonBgColor,
    buttonHoverColor,
    buttonFontColor,
    buttonFont,
  } = appearance;

  /* ------------------------------ Fonts ------------------------------ */
  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);

  /* ------------------------------ Language / copy ------------------------------ */
  const langCode =
    currentEvent?.settings?.language ??
    globalSettings?.language ??
    "en";
  const t = resolveLocale(langCode);

  /* ------------------------------ App mode / payment copy ------------------------------ */
  const appMode =
    currentEvent?.settings?.appMode ?? globalSettings?.appMode ?? "rental";
  const paymentEnabled =
    currentEvent?.settings?.business?.paymentEnabled ??
    globalSettings?.business?.paymentEnabled ??
    false;

  const description =
    appMode === "business" && paymentEnabled ? t.descBusiness : t.descRental;

  /* ------------------------------ Templates ------------------------------ */
  const normalizeTemplate = (tpl) => {
    if (!tpl) return null;
    const id =
      tpl.id ??
      tpl.templateId ??
      `${tpl.name ?? "tpl"}-${Math.random().toString(36).slice(2, 6)}`;
    const name = tpl.name ?? tpl.title ?? "Template";
    const thumbRaw =
      tpl.previewMeta?.thumbnailDataUrl ??
      tpl.previewMeta?.thumbnailPath ??
      tpl.thumbnail ??
      null;

    const layout = tpl.previewMeta?.layout ?? tpl.layout ?? null;
    const version =
      tpl.previewMeta?.updatedAt ??
      tpl.previewMeta?.thumbnailVersion ??
      null; // (Patch B will provide updatedAt)

    const thumb = thumbRaw ? normalizeToFileUrl(thumbRaw) : null;
    const thumbSrc = thumb ? withCacheBust(thumb, version) : null;
    const isTwoBySix = String(layout).toLowerCase() === "2x6";

    let icon;
    if (thumb) {
      // For 2×6, show two copies with the lower one slanted.
      icon = isTwoBySix ? (
        <TwoUpStrip src={thumb} alt={name} />
      ) : (
        <img
          src={thumb}
          alt={name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      );
    } else {
      // No thumbnail: choose a default icon based on layout
      const layoutKey = String(layout || "").toLowerCase();

      if (layoutKey === "2x6") {
        // Two-up vertical strips for 2×6 (without real thumbnail)
        icon = (
          <div className="relative pointer-events-none h-full w-full">
            <div className="absolute left-1/2 -translate-x-1/2 h-[350px] mx-auto">
              <PhotoStripVertical />
            </div>
            <div className="h-[350px] mx-auto rotate-[30deg] shadow-lg border">
              <PhotoStripVertical />
            </div>
          </div>
        );
      } else if (layoutKey === "6x2") {
        // Horizontal strip placeholder for 6×2
        icon = <PhotoStripHorizontal />;
      } else if (layoutKey === "6x4") {
        // Landscape postcard placeholder for 6×4
        icon = <PostcardLandscape />;
      } else {
        // Default to postcard (portrait-ish) for 4×6 or unknown
        icon = <PostcardSquare />;
      }
    }
    return { id, name, layout, thumbSrc, icon };
  };

  const finalTemplates =
    Array.isArray(currentEvent?.appliedTemplates) && currentEvent.appliedTemplates.length > 0
      ? currentEvent.appliedTemplates.map(normalizeTemplate).filter(Boolean)
      : Array.isArray(templates) && templates.length > 0
        ? templates.map(normalizeTemplate).filter(Boolean)
        : DEFAULT_PLACEHOLDERS;

  /* ------------------------------ Timers ------------------------------ */
  const resolvedTimer =
    currentEvent?.settings?.screenTimers?.template ??
    globalSettings?.screenTimers?.template ??
    defaultTimer;

  const totalTime = Math.max(1, Number(resolvedTimer) || DEFAULT_TIMERS.template);
  const [mounted, setMounted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(totalTime);

  useEffect(() => setTimeLeft(totalTime), [totalTime]);

  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const progress = (timeLeft / totalTime) * circumference;

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (timeLeft <= 0) {
      setTimeout(() => onCancel(), 700);
      return;
    }
    const interval = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [timeLeft, onCancel]);

  const carouselRef = useRef(null);

  const totalPages = Math.max(1, Math.ceil(finalTemplates.length / itemsPerView));

  const getPageStartPositions = () => {
    const el = carouselRef.current;
    if (!el) return [];

    const cards = Array.from(el.querySelectorAll("[data-template-card]"));
    if (!cards.length) return [];

    const starts = [];
    for (let i = 0; i < cards.length; i += itemsPerView) {
      starts.push(cards[i].offsetLeft);
    }

    return starts;
  };

  const updateCarouselButtons = () => {
    const el = carouselRef.current;
    if (!el) return;

    const pageStarts = getPageStartPositions();
    if (!pageStarts.length) {
      setActiveIndex(0);
      return;
    }

    const currentScroll = el.scrollLeft;

    let closestIndex = 0;
    let closestDistance = Infinity;

    pageStarts.forEach((start, index) => {
      const distance = Math.abs(currentScroll - start);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    setActiveIndex(Math.min(closestIndex, pageStarts.length - 1));
  };

  const scrollToIndex = (index) => {
    const el = carouselRef.current;
    if (!el) return;

    const pageStarts = getPageStartPositions();
    if (!pageStarts.length) return;

    const safeIndex = Math.max(0, Math.min(index, pageStarts.length - 1));

    setActiveIndex(safeIndex);

    el.scrollTo({
      left: pageStarts[safeIndex],
      behavior: "smooth",
    });
  };

  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return;

    const clampActiveIndex = () => {
      setActiveIndex((prev) => Math.min(prev, totalPages - 1));
    };

    clampActiveIndex();

    const handleScroll = () => {
      updateCarouselButtons();
    };

    const handleResize = () => {
      clampActiveIndex();

      requestAnimationFrame(() => {
        updateCarouselButtons();
      });
    };

    requestAnimationFrame(() => {
      updateCarouselButtons();
    });

    el.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      el.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [finalTemplates.length, itemsPerView, totalPages]);


  /* ------------------------------ Background media ------------------------------ */
  const isGif =
    !!backgroundMediaPath && backgroundMediaPath.toLowerCase().endsWith(".gif");

  const theme = boothTheme({
    bgColor, headerFontColor, generalFontColor, buttonBgColor, buttonHoverColor, buttonFontColor,
    headerFont, generalFont,
  });

  if (isUnsupported) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center text-center gap-6" style={{ backgroundColor: bgColor }}>
        <p style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(22px, 3vw, 56px)', fontWeight: 'bold' }}>Display Not Supported</p>
        <p style={{ fontFamily: generalFont, color: generalFontColor, fontSize: 'clamp(14px, 1.8vw, 34px)' }}>Minimum resolution: 1080 × 1920 (Full HD portrait)</p>
      </div>
    );
  }

  return (
    <motion.div
      {...SCREEN_MOTION}
      className="relative w-full h-screen overflow-hidden flex flex-col"
      style={{ backgroundColor: bgColor }}
    >
      {/* Top bar: logo + timer, the same on every booth screen */}
      <BoothTopBar theme={theme} logoSrc={logoPath} name={boothName} showLogo={logoOnEveryScreen(event)}>
        <BoothTimer theme={theme} seconds={timeLeft} />
      </BoothTopBar>

      {/* Title + description */}
      <div className="shrink-0 relative z-10" style={{ padding: "0 clamp(16px, 3vw, 48px)" }}>
        <h1 style={{ ...TYPE.display, fontFamily: headerFont, color: headerFontColor }}>
          {t.choose} {t.your} <span className="italic">{t.template}</span>
        </h1>
        {description && (
          <p style={{ ...TYPE.body, fontFamily: generalFont, color: theme.muted, marginTop: 8 }}>
            {description}
          </p>
        )}
      </div>

      {/* Row 2: Description + carousel + nav dots */}
      <div className="flex-1 min-h-0 flex flex-col w-full relative z-10 overflow-hidden" style={{ marginTop: '1vh' }}>
        <motion.div
          className="relative flex-1 min-h-0 flex flex-col w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >

          {/* Carousel */}
          <div
            ref={carouselRef}
            className={`template-carousel flex-1 min-h-0 ${isPortrait ? "flex flex-col overflow-y-auto overflow-x-hidden" : "flex items-center overflow-x-auto overflow-y-hidden snap-x snap-mandatory px-8 sm:px-12 lg:px-16"} [scrollbar-width:none] [-ms-overflow-style:none]`}
            style={{ WebkitOverflowScrolling: "touch", scrollBehavior: "smooth", ...(isPortrait ? { padding: '1vh 4vw' } : { paddingTop: '1rem', paddingBottom: '1rem' }) }}
          >
            <div
              className={`flex gap-6 sm:gap-8 lg:gap-10 ${isPortrait ? "flex-wrap justify-center items-start" : "items-center"}`}
              style={isPortrait ? { margin: 'auto 0' } : { margin: '0 auto' }}
            >
              {finalTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  data-template-card
                  onClick={() => {
                    onSelect(tpl);
                    if (typeof onApplyTemplate === "function") onApplyTemplate(tpl);
                  }}
                  className={`flex-shrink-0 snap-start ${isPortrait ? "w-[260px]" : isTablet ? "w-[320px]" : "w-[300px] sm:w-[340px] md:w-[380px] lg:w-[420px]"} flex flex-col items-center group touch-manipulation transition-all rounded-md focus:outline-none`}
                  style={{ backgroundColor: "transparent" }}
                >
                  <div
                    className={`flex items-center ${isPortrait ? "h-[300px]" : isTablet ? "h-[360px]" : "h-[340px] md:h-[400px] lg:h-[460px]"} justify-center transform transition-all duration-300 group-hover:-translate-y-1 group-active:scale-[0.98] w-full`}
                    style={{
                      borderColor: "rgba(229, 231, 235, 1)",
                    }}
                  >
                    {(() => {
                      const layoutKey = String(tpl.layout || "").toLowerCase();
                      const aspectMap = {
                        "4x6": "aspect-[4/6]",
                        "2x6": "aspect-[2/6]",
                        "6x4": "aspect-[6/4]",
                        "6x2": "aspect-[6/2]",
                      };
                      const aspectClass = aspectMap[layoutKey] ?? aspectMap["4x6"];
                      const isTall = layoutKey === "4x6" || layoutKey === "2x6";

                      return (
                        <div
                          className={`pointer-events-none ${aspectClass} ${isTall
                            ? (isPortrait ? "h-[290px]" : isTablet ? "h-[350px]" : "h-[330px] md:h-[390px] lg:h-[450px]")
                            : (isPortrait ? "w-[290px]" : isTablet ? "w-[310px]" : "w-[330px] md:w-[390px] lg:w-[450px]")
                          } flex items-center justify-center`}
                        >
                          {tpl.thumbSrc ? (
                            layoutKey === "2x6" || layoutKey === "6x2" ? (
                              <TwoUpStrip
                                src={tpl.thumbSrc}
                                alt={tpl.name}
                                orientation={layoutKey}
                              />
                            ) : (
                              <>
                                <img
                                  src={tpl.thumbSrc}
                                  alt={tpl.name}
                                  className="w-full h-full object-cover"
                                  style={{ border: `1px solid ${theme.line}`, borderRadius: 10 }}
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    const fb = e.currentTarget.parentElement?.querySelector('[data-thumb-fallback]');
                                    if (fb) fb.style.display = 'flex';
                                  }}
                                />
                                <div data-thumb-fallback className="w-full h-full" style={{ display: 'none' }}>{tpl.icon}</div>
                              </>
                            )
                          ) : (
                            <div className="w-full h-full">{tpl.icon}</div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div
                    className="text-center transition-opacity group-hover:opacity-100"
                    style={{
                      ...TYPE.body,
                      fontWeight: 600,
                      marginTop: "clamp(10px, 1.6vh, 18px)",
                      fontFamily: generalFont,
                      color: theme.text,
                      opacity: 0.9,
                    }}
                  >
                    {tpl.name}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="shrink-0 flex justify-center" style={{ paddingTop: '0.5vh', paddingBottom: '0.5vh' }}>
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-full"
              style={{
                backgroundColor: "transparent",
              }}
            >
              {Array.from({ length: totalPages }).map((_, i) => {
                const isActive = activeIndex === i;

                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => scrollToIndex(i)}
                    aria-label={`Go to page ${i + 1}`}
                    className="touch-manipulation rounded-full transition-all duration-300 ease-out"
                    style={{
                      width: isActive ? 28 : 10,
                      height: 10,
                      backgroundColor: isActive ? buttonBgColor : theme.line,
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    <span className="sr-only">{`Page ${i + 1}`}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <style>{`
            .template-carousel::-webkit-scrollbar {
              display: none;
            }
          `}</style>
        </motion.div>
      </div>

    </motion.div>
  );
}
