
// src/components/TemplateSelectionScreen.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";
import { useLayout } from "../utils/useLayout";

/* ---------------------------- Helpers ---------------------------- */
/** Parse capture filename meta: capture_<index>-of-<total>_<timestamp>.jpg */
function parseCaptureMeta(url) {
  const m = String(url).match(/capture_(\d+)-of-(\d+)_([0-9]+)\.(jpg|jpeg|png|webp)$/i);
  return m ? { url, index: +m[1], total: +m[2], timestamp: +m[3] } : null;
}

/* Simple i18n for this screen */
const STRINGS = {
  en: {
    by: "by",
    brandDefaultName: "Studio Photuna",
    brandDefaultSlogan: "Ahead of the moment.",
    instructions1:
      "Select photos on the left. The first selection fills the first slot, and so on.",
    instructions2:
      "When the countdown reaches zero, any unfilled slots will be automatically assigned random photos from your selections.",
    photosCount: "Photos",
    back: "Back",
    next: "Next →",
    slotLabel: (n) => `Slot ${n}`,
    slotBadge: (n) => `#${n}`,
    secondsSuffix: "s",
  },
  tl: {
    by: "gawa ng",
    brandDefaultName: "Studio Photuna",
    brandDefaultSlogan: "Mas nauna sa sandali.",
    instructions1:
      "Pumili ng mga larawan sa kaliwa. Ang unang pili ay mapupunta sa unang puwesto, at iba pa.",
    instructions2:
      "Kapag umabot sa zero ang countdown, ang mga bakanteng puwesto ay awtomatikong mapupunan ng mga larawang napili.",
    photosCount: "Mga Larawan",
    back: "Bumalik",
    next: "Susunod →",
    slotLabel: (n) => `Puwesto ${n}`,
    slotBadge: (n) => `#${n}`,
    secondsSuffix: "seg",
  },
};

const resolveStrings = (code) => {
  const k = String(code ?? 'en').toLowerCase();
  return (k === "tl" || k === "tagalog" || k === "fil" || k === "filipino")
    ? STRINGS.tl
    : STRINGS.en;
};

/* Resolves the thumbnail URL from wherever AdminDashboard stored it */
const resolveThumbnailSrc = (tpl) => {
  const raw =
    tpl?.previewMeta?.thumbnailDataUrl ??
    tpl?.previewMeta?.thumbnailPath ??
    tpl?.thumbnail ??
    null;
  return raw ? normalizeToFileUrl(raw) : null;
};

/* ---------------------- Main selection screen --------------------- */
export default function TemplateSelectionScreen({
  eventId = "default",
  countdownStart = 40, // fallback if no event timer
  numberOfShots = 1,   // fallback if no event setting
  photos: photosProp,  // optional: pass session photos
  template: templateProp, // IMPORTANT: pass selectedTemplate with saved slots
  onNext,
  onCancel,
}) {
  // Appearance + Settings from AdminDashboard
  const [appearance, setAppearance] = useState({
    boothName: "",
    boothSlogan: "",
    logoPath: null,
    headerFont: "Inter",
    generalFont: "Inter",
    buttonFont: "Interphases",
    headerFontColor: "#111827",
    generalFontColor: "#374151",
    bgColor: "#ffffff",
    buttonBgColor: "#2563eb",
    buttonHoverColor: "#1e40af",
    buttonFontColor: "#ffffff",
  });
  const [settings, setSettings] = useState(null);

  // Effective screen strings based on language
  const T = resolveStrings(settings?.language ?? "en");

  // Effective timers & shots

  const effectiveCountdownStart =
    settings?.screenTimers?.photoselect ??
    settings?.screenTimers?.templateselection ?? // legacy/old builds
    countdownStart;

  const effectiveNumberOfShots = settings?.numberOfShots ?? numberOfShots;

  const [timeLeft, setTimeLeft] = useState(effectiveCountdownStart);
  const [photos, setPhotos] = useState([]);
  const [selectedIndices, setSelectedIndices] = useState([]);
  const hasAutoAdvancedRef = useRef(false);

  // Normalize slots from previewMeta if slots is missing or is just a count
  const normalizedSlots = useMemo(() => {
    if (Array.isArray(templateProp?.slots) && templateProp.slots.length > 0) {
      // Already an array of slot objects
      return templateProp.slots;
    }
    // AdminDashboard saved slots live under previewMeta.slots
    return Array.isArray(templateProp?.previewMeta?.slots)
      ? templateProp.previewMeta.slots
      : [];
  }, [templateProp]);

  // NEW: read layout ("4x6","2x6","6x4","6x2") from previewMeta or fall back to 4x6
  const normalizedLayout = useMemo(() => {
    const raw = templateProp?.previewMeta?.layout ?? templateProp?.layout ?? "4x6";
    const key = String(raw).toLowerCase();
    return ["4x6", "2x6", "6x4", "6x2"].includes(key) ? key : "4x6";
  }, [templateProp]);

  const [template, setTemplate] = useState(() => ({
    id: templateProp?.id ?? "",
    name: templateProp?.name ?? "",
    slots: normalizedSlots,
    layout: normalizedLayout,
    thumbnailSrc: resolveThumbnailSrc(templateProp),
  }));

  const totalSlots = Array.isArray(template.slots) ? template.slots.length : 0;

  /* ---------------- Load template ---------------- */
  useEffect(() => {
    if (templateProp) {
      setTemplate({
        id: templateProp.id ?? "",
        name: templateProp.name ?? "",
        slots: normalizedSlots,
        layout: normalizedLayout,
        thumbnailSrc: resolveThumbnailSrc(templateProp),
      });
      return;
    }

    (async () => {
      try {
        const t = await window.electron.getActiveTemplate(eventId);
        const slotsFromPreview = Array.isArray(t?.previewMeta?.slots)
          ? t.previewMeta.slots
          : [];
        setTemplate({
          id: t?.id ?? "",
          name: t?.name ?? "",
          slots: slotsFromPreview,
          layout: t?.previewMeta?.layout ?? "4x6",
          thumbnailSrc: resolveThumbnailSrc(t),
        });
      } catch (err) {
        console.error("Failed to load template:", err);
        setTemplate({ id: "", name: "", slots: [], layout: "4x6", thumbnailSrc: null });
      }
    })();
  }, [eventId, templateProp]);

  /* ---------------- Load appearance + settings from AdminDashboard ---------------- */
  useEffect(() => {
    (async () => {
      try {
        // Prefer event-scoped values; fall back to global if eventId not supported
        const [app, sett] = await Promise.all([
          window.electron?.getAppearance?.(eventId) ??
          window.electron?.getAppearance?.(),
          window.electron?.getSettings?.(eventId) ??
          window.electron?.getSettings?.(),
        ]);

        if (app) {
          const nextApp = {
            boothName: app.boothName ?? appearance.boothName,
            boothSlogan: app.boothSlogan ?? appearance.boothSlogan,
            logoPath: app.logoPath ?? null,
            headerFont: app.headerFont ?? appearance.headerFont,
            generalFont: app.generalFont ?? appearance.generalFont,
            buttonFont: app.buttonFont ?? appearance.buttonFont,
            headerFontColor: app.headerFontColor ?? appearance.headerFontColor,
            generalFontColor: app.generalFontColor ?? appearance.generalFontColor,
            bgColor: app.bgColor ?? appearance.bgColor,
            buttonBgColor: app.buttonBgColor ?? appearance.buttonBgColor,
            buttonHoverColor: app.buttonHoverColor ?? appearance.buttonHoverColor,
            buttonFontColor: app.buttonFontColor ?? appearance.buttonFontColor,
          };
          setAppearance(nextApp);
          // Load fonts the same way AdminDashboard does
          loadGoogleFont(nextApp.headerFont);
          loadGoogleFont(nextApp.generalFont);
          loadGoogleFont(nextApp.buttonFont);
        }

        if (sett) {
          setSettings(sett);
          // Reset countdown to effective source
          const nextCountdown =
            sett?.screenTimers?.templateselection ?? countdownStart;
          setTimeLeft(nextCountdown);
        }
      } catch (err) {
        console.warn("Failed to load appearance/settings:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  /* ---------------- Load photos: prop first, else latest session ---------------- */
  useEffect(() => {
    (async () => {
      try {
        // Always take at least as many photos as there are template slots.
        const shots = Math.max(effectiveNumberOfShots, totalSlots);
        if (Array.isArray(photosProp) && photosProp.length > 0) {
          // Don't slice — photosProp is already the curated session capture.
          setPhotos(photosProp.map(normalizeToFileUrl));
          return;
        }
        const imgs = await window.electron.getCapturedPhotos(eventId);
        const normalized = (imgs || []).map(normalizeToFileUrl);

        const parsed = normalized.map(parseCaptureMeta).filter(Boolean);

        if (parsed.length > 0) {
          parsed.sort((a, b) => b.timestamp - a.timestamp);
          const latestBatch = parsed.slice(0, shots).map((p) => p.url);
          setPhotos(latestBatch);
        } else {
          // fallback if filenames do not match expected pattern
          setPhotos(normalized.slice(-shots));
        }
      } catch (err) {
        console.error("Failed to load photos:", err);
        setPhotos([]);
      }
    })();
  }, [eventId, effectiveNumberOfShots, totalSlots, photosProp]);

  /* ---------------- Countdown ---------------- */
  useEffect(() => {
    if (timeLeft <= 0) return;
    const id = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timeLeft]);

  /* ---------------- Selection logic ---------------- */
  const toggleSelection = (index) => {
    setSelectedIndices((prev) => {
      if (prev.includes(index)) return prev.filter((i) => i !== index);
      if (prev.length >= totalSlots) return prev;
      return [...prev, index];
    });
  };

  const slotAssignments = useMemo(() => {
    const map = {};
    (template.slots || []).forEach((slot, i) => {
      map[slot.id] = selectedIndices[i] ?? null;
    });
    return map;
  }, [template.slots, selectedIndices]);

  /* ---------------- Save selection ---------------- */
  const onSave = async () => {
    if (hasAutoAdvancedRef.current) return;
    hasAutoAdvancedRef.current = true;

    const payload = {
      eventId,
      templateId: template.id,
      layout: template.layout,
      slots: (template.slots || []).map((slot) => {
        const idx = slotAssignments[slot.id];
        const url = Number.isFinite(idx) ? photos[idx] ?? null : null;
        return {
          slotId: slot.id,
          slotNumber: slot.slotNumber,
          photoIndex: idx,       // keep for backward compatibility
          photoUrl: url,         // NEW: absolute identity of the selected image
        };
      }),

      // Optional: include language/mode for downstream screens if needed
      language: settings?.language ?? "en",
      appMode: settings?.appMode ?? "rental",
    };
    try {
      await window.electron.saveTemplateSelection(payload);
    } catch (err) {
      console.error("Failed to save template selection:", err);
    }
    onNext?.(payload);
  };

  /* ---------------- Auto-fill + auto-advance ---------------- */
  useEffect(() => {
    if (timeLeft !== 0) return;
    if (selectedIndices.length >= totalSlots) return;

    const remaining = Math.max(0, totalSlots - selectedIndices.length);
    const available = photos.map((_, i) => i).filter((i) => !selectedIndices.includes(i));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const autoFill = shuffled.slice(0, remaining);

    setSelectedIndices((prev) => [...prev, ...autoFill]);
  }, [timeLeft, totalSlots, photos, selectedIndices]);

  // Stable content key so a new array reference from the parent doesn't trigger a reset
  const photoKey = useMemo(
    () => (photosProp || []).filter(Boolean).join('|'),
    [photosProp]
  );

  // Reset selections when a new session starts (compare by content, not reference)
  useEffect(() => {
    setSelectedIndices([]);
    hasAutoAdvancedRef.current = false;
    setTimeLeft(effectiveCountdownStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, photoKey, templateProp?.id, effectiveCountdownStart]);

  useEffect(() => {
    if (timeLeft !== 0) return;
    if (hasAutoAdvancedRef.current) return;
    if (selectedIndices.length >= totalSlots && totalSlots > 0) {
      onSave();
    }
  }, [timeLeft, selectedIndices, totalSlots]);

  /* ---------------- Circular countdown ring ---------------- */
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const progress = (timeLeft / effectiveCountdownStart) * circumference;

  /* ---------------- Derived styles ---------------- */
  const brandName = appearance.boothName || T.brandDefaultName;
  const brandSlogan = appearance.boothSlogan || T.brandDefaultSlogan;
  const brandColor = appearance.headerFontColor || "#111827";
  const bodyColor = appearance.generalFontColor || "#374151";
  const primaryColor = appearance.buttonBgColor || "#ec4899"; // pink fallback
  const uiFont = appearance.generalFont || "Inter";
  const headerFont = appearance.headerFont || "Inter";
  const buttonFont = appearance.buttonFont || "Interphases";
  const logoPath = appearance.logoPath || null;
  const logoScale = (appearance.logoSize ?? 100) / 100;
  const buttonFontColor = appearance.buttonFontColor || "#000000";
  const buttonHoverColor = appearance.buttonHoverColor || "gray";


  const { isPortrait, isUnsupported, isPortrait2K, isTablet } = useLayout();

  /* ---------------- Render ---------------- */
  if (isUnsupported) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center text-center gap-6" style={{ backgroundColor: appearance.bgColor }}>
        <p style={{ fontFamily: headerFont, color: brandColor, fontSize: 'clamp(22px, 3vw, 56px)', fontWeight: 'bold' }}>Display Not Supported</p>
        <p style={{ fontFamily: uiFont, color: bodyColor, fontSize: 'clamp(14px, 1.8vw, 34px)' }}>Minimum resolution: 1080 × 1920 (Full HD portrait)</p>
      </div>
    );
  }

  return (
    <div
      className="w-full h-screen text-black overflow-hidden flex flex-col p-3"
      style={{ backgroundColor: appearance.bgColor || "#ffffff", color: bodyColor, fontFamily: uiFont }}
    >

      {/* ── Header: logo + timer — always in flow so scroll never overlaps ── */}
      <div
        className="shrink-0 flex items-center"
        style={{ padding: isPortrait ? '2vh 4vw' : '6px 24px 4px' }}
      >
        {/* Logo */}
        <div style={{ flex: 1 }}>
          {logoPath ? (
            isPortrait
              ? <img src={logoPath} alt="logo" style={{ maxHeight: `${Math.round(60 * logoScale)}px` }} className="w-auto object-contain" />
              : <img src={logoPath} alt="logo" style={{ maxWidth: `${Math.round(300 * logoScale)}px` }} className="object-contain" />
          ) : isPortrait ? (
            <span className="font-bold" style={{ fontFamily: headerFont, color: brandColor, fontSize: 'clamp(18px, 2.5vw, 46px)' }}>{brandName}</span>
          ) : (
            <div>
              <h1 className="font-bold" style={{ fontFamily: headerFont, color: brandColor, fontSize: 'clamp(22px, 3.5vw, 56px)' }}>{brandName}</h1>
              {brandSlogan && <p style={{ color: bodyColor, fontSize: 'clamp(12px, 1.4vw, 22px)' }}>{brandSlogan}</p>}
            </div>
          )}
        </div>

        {/* Timer — centered via flex spacers */}
        <div
          className="rounded-full font-bold shadow-sm px-5 py-2"
          style={{
            backgroundColor: primaryColor,
            color: buttonFontColor,
            fontFamily: uiFont,
            fontSize: isPortrait ? 'clamp(16px, 2vw, 38px)' : 'clamp(14px, 1.8vw, 26px)',
          }}
          aria-live="polite"
        >
          {Math.max(0, timeLeft)}s
        </div>

        {/* Right spacer — keeps timer visually centered in landscape */}
        {!isPortrait && <div style={{ flex: 1 }} />}
      </div>

      {/* ── Body: 2-column (landscape) or reordered stack (portrait) ── */}
      <div
        className={`flex-1 min-h-0 ${isPortrait ? "flex flex-col" : "grid grid-cols-2 pb-[50px]"}`}
      >
        {/* LEFT column: photo grid + counter + next button */}
        <div
          className={isPortrait ? "flex-1 min-h-0 flex flex-col" : "col-span-1 h-full min-h-0 flex flex-col"}
          style={isPortrait ? { order: 2 } : undefined}
        >
          {/* Photo grid */}
          <div
            className={`flex-1 min-h-0 overflow-y-auto light-scroll ${isPortrait ? "" : "pt-4 px-8"}`}
            style={isPortrait ? { padding: '2vh 4vw 1vh' } : undefined}
          >
            <div className={`grid gap-3 ${isPortrait ? "grid-cols-3" : "grid-cols-2"}`}>
              {photos.map((src, i) => {
                const selected = selectedIndices.includes(i);
                const order = selected ? selectedIndices.indexOf(i) + 1 : null;
                return (
                  <button
                    key={i}
                    onClick={() => toggleSelection(i)}
                    className={`relative overflow-hidden rounded-xl shadow-md border-2 transition-transform active:scale-95 ${selected ? "border-black" : "border-gray-200"}`}
                    style={{ fontFamily: uiFont }}
                  >
                    <img src={src} alt={`Photo ${i + 1}`} className="w-full aspect-square object-cover" />
                    {selected && (
                      <div className="absolute top-2 left-2">
                        <span className="text-white text-xs font-bold px-2 py-1 rounded-md" style={{ backgroundColor: primaryColor, fontFamily: buttonFont }}>
                          {order}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Counter + buttons — pinned below photo grid */}
          <div
            className={`shrink-0 flex items-center justify-between ${isPortrait ? "" : "px-8 py-4"}`}
            style={isPortrait ? { padding: '1vh 4vw 2vh' } : undefined}
          >
            <span
              className="flex items-center gap-2 px-10 py-4 rounded-full font-bold shadow-lg"
              style={{ backgroundColor: primaryColor, color: "#fff", fontFamily: buttonFont, fontSize: isPortrait ? 'clamp(18px, 2.5vw, 46px)' : '1.5rem' }}
            >
              {T.photosCount} {selectedIndices.length}/{totalSlots}
            </span>
            <div className="flex items-center gap-3">
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="px-5 py-2 rounded-full font-semibold bg-gray-200 hover:bg-gray-300 transition"
                  style={{ fontFamily: uiFont, fontSize: isPortrait ? 'clamp(14px, 1.8vw, 34px)' : '1.125rem' }}
                >
                  {T.back}
                </button>
              )}
              <button
                onClick={onSave}
                disabled={selectedIndices.length < totalSlots || selectedIndices.length === 0}
                className={`flex items-center gap-2 px-10 py-4 rounded-full font-bold shadow-lg transition ${
                  selectedIndices.length >= totalSlots && totalSlots > 0 ? "cursor-pointer" : "bg-gray-300 text-gray-500 cursor-not-allowed"
                }`}
                style={{
                  fontFamily: buttonFont,
                  fontSize: isPortrait ? 'clamp(18px, 2.5vw, 46px)' : '1.5rem',
                  backgroundColor: selectedIndices.length >= totalSlots && totalSlots > 0 ? primaryColor : undefined,
                  color: selectedIndices.length >= totalSlots && totalSlots > 0 ? buttonFontColor : undefined,
                }}
                onMouseEnter={(e) => {
                  if (selectedIndices.length >= totalSlots && totalSlots > 0) {
                    e.currentTarget.style.backgroundColor = buttonHoverColor;
                    e.currentTarget.style.color = buttonFontColor;
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedIndices.length >= totalSlots && totalSlots > 0) {
                    e.currentTarget.style.backgroundColor = primaryColor;
                    e.currentTarget.style.color = buttonFontColor;
                  }
                }}
              >
                {T.next}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT column: template preview */}
        <div
          className={isPortrait
            ? "shrink-0 overflow-hidden flex items-center justify-center"
            : "col-span-1 h-full overflow-y-auto light-scroll px-8 pt-4 pb-8"
          }
          style={isPortrait ? { padding: '1vh 4vw', order: 1, height: '42vh' } : undefined}
        >
        {(() => {
          const layoutKey = normalizedLayout;
          const isStrip = layoutKey === "2x6" || layoutKey === "6x2";
          const aspectStyle = {
            aspectRatio:
              layoutKey === "2x6" ? "2 / 6" :
              layoutKey === "6x4" ? "6 / 4" :
              layoutKey === "6x2" ? "6 / 2" :
              "4 / 6",
          };
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

          const Canvas = (
            <div className="relative w-full h-full bg-white">
              {template.slots.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center bg-gray-50">
                  <div className="text-4xl opacity-20">🖼️</div>
                  <div className="text-sm text-gray-500 font-medium">Template preview</div>
                  <div className="text-xs text-gray-400">No slot layout saved</div>
                </div>
              )}
              {template.slots.map((slot, idx) => {
                const photoIndex = slotAssignments[slot.id];
                const src = Number.isFinite(photoIndex) ? photos[photoIndex] : null;
                const slotNum = slot.slotNumber ?? idx + 1;
                return (
                  <div
                    key={slot.id ?? idx}
                    className="absolute overflow-hidden"
                    style={{
                      left: `${slot.x * 100}%`,
                      top: `${slot.y * 100}%`,
                      width: `${slot.w * 100}%`,
                      height: `${slot.h * 100}%`,
                      transform: `rotate(${slot.rotation || 0}deg)`,
                      transformOrigin: "center",
                    }}
                  >
                    {src ? (
                      <img src={src} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: 'rgba(99,102,241,0.12)', border: '2px dashed rgba(99,102,241,0.5)' }}>
                        <span className="text-xs font-bold" style={{ color: 'rgba(99,102,241,0.8)' }}>{slotNum}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );

          if (!isStrip) {
            return (
              <div className="min-h-full flex items-center justify-center">
                <div className={`shadow-lg border border-gray-200 relative overflow-hidden ${boxClass}`} style={aspectStyle}>{Canvas}</div>
              </div>
            );
          }
          if (layoutKey === "2x6") {
            return (
              <div className="min-h-full flex items-center justify-center gap-6">
                <div className={`shadow-lg border border-gray-200 relative overflow-hidden ${boxClass}`} style={aspectStyle}>{Canvas}</div>
                <div className={`shadow-lg border border-gray-200 relative overflow-hidden ${boxClass}`} style={aspectStyle}>{Canvas}</div>
              </div>
            );
          }
          return (
            <div className="min-h-full flex flex-col items-center justify-center gap-6">
              <div className={`shadow-lg border border-gray-200 relative overflow-hidden ${boxClass}`} style={aspectStyle}>{Canvas}</div>
              <div className={`shadow-lg border border-gray-200 relative overflow-hidden ${boxClass}`} style={aspectStyle}>{Canvas}</div>
            </div>
          );
        })()}
        </div>
      </div>

    </div>
  );
}