// src/PhotoBooth/SelectRetakeScreen.jsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowUturnLeftIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import { useLayout } from "../utils/useLayout";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import {
  boothTheme, BoothTopBar, BoothTimer, BoothChip, BoothButton,
  TYPE, SCREEN_MOTION, RADIUS, panelStyle,
} from "../components/booth/boothUi";

const DEFAULT_APPEARANCE = {
  boothName: "Studio Photuna",
  boothSlogan: "Ahead of the moment.",
  headerFont: "Ramillas",
  generalFont: "Interphases",
  headerFontColor: "#111827",
  generalFontColor: "#4b5563",
  bgColor: "#ffffff",
  logoPath: null,
  backgroundMediaPath: null,
  buttonBgColor: "#ec4899",
  buttonHoverColor: "#db2777",
  buttonFont: "Interphases",
  buttonFontColor: "#ffffff",
};

export default function SelectRetakeScreen({
  photos = [],
  frame = null,
  onRetake,
  onConfirm,
  onBack,
  retakeLimit: propRetakeLimit = 1,
  retakenIndices = [],
  event = null,
  eventId = "default",
}) {
  const { isPortrait, isUnsupported, isTablet } = useLayout();
  const [selectedIndices, setSelectedIndices] = useState([]);
  const [mounted, setMounted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(8);
  const [localRetaken, setLocalRetaken] = useState(retakenIndices || []);
  const [currentEvent, setCurrentEvent] = useState(event ?? null);
  const [globalSettings, setGlobalSettings] = useState(null);
  const [saving, setSaving] = useState(false);

  const appearance = {
    ...DEFAULT_APPEARANCE,
    ...(currentEvent?.appearance || {}),
  };

  const {
    boothName,
    boothSlogan,
    headerFont,
    generalFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    logoPath,
    logoSize,
    backgroundMediaPath,
    buttonBgColor,
    buttonHoverColor,
    buttonFont,
    buttonFontColor,
  } = appearance;
  const logoScale = (logoSize ?? 100) / 100;

  const effectiveRetakeLimit =
    currentEvent?.settings?.retakeLimit ?? propRetakeLimit;

  const effectiveEventId = currentEvent?.id ?? eventId;

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => {
      clearTimeout(t);
      setMounted(false);
    };
  }, []);

  useEffect(() => {
    setCurrentEvent(event ?? null);
    if (event?.retakenIndices) {
      setLocalRetaken(event.retakenIndices);
    }
  }, [event]);

  useEffect(() => {
    setLocalRetaken((prev = []) => {
      const maxIndex = Math.max(0, photos.length - 1);
      return (prev || []).filter(
        (idx) => Number.isInteger(idx) && idx >= 0 && idx <= maxIndex
      );
    });
  }, [photos]);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (window.api?.getSettings) {
          const s = await window.api.getSettings();
          setGlobalSettings(s || null);
        } else if (window.electron?.getSettings) {
          const s = await window.electron.getSettings();
          setGlobalSettings(s || null);
        }
      } catch {
        setGlobalSettings(null);
      }
    };

    fetchSettings();
  }, []);

  useEffect(() => {
    const handler = async () => {
      try {
        if (!effectiveEventId) return;

        if (window.api?.getEventData) {
          const updated = await window.api.getEventData(effectiveEventId);
          if (updated) {
            setCurrentEvent(updated);
            if (updated.retakenIndices) {
              setLocalRetaken(updated.retakenIndices);
            }
          }
        } else if (window.electron?.getEventData) {
          const updated = await window.electron.getEventData(effectiveEventId);
          if (updated) {
            setCurrentEvent(updated);
            if (updated.retakenIndices) {
              setLocalRetaken(updated.retakenIndices);
            }
          }
        }
      } catch {
        // no-op
      }
    };

    if (window.api?.onEventsUpdated) {
      window.api.onEventsUpdated(handler);
      return () => window.api?.offEventsUpdated?.(handler);
    }

    if (window.electron?.onEventsUpdated) {
      window.electron.onEventsUpdated(handler);
      return () => window.electron?.offEventsUpdated?.(handler);
    }

    return undefined;
  }, [effectiveEventId]);

  const deriveRetakeSeconds = useCallback(() => {
    const eventSeconds = currentEvent?.settings?.screenTimers?.retake;
    const globalSeconds = globalSettings?.screenTimers?.retake;

    return Number.isFinite(eventSeconds)
      ? eventSeconds
      : Number.isFinite(globalSeconds)
        ? globalSeconds
        : 8;
  }, [currentEvent?.settings?.screenTimers?.retake, globalSettings]);

  useEffect(() => {
    setTimeLeft(deriveRetakeSeconds());
  }, [deriveRetakeSeconds]);

  useEffect(() => {
    if (timeLeft <= 0) {
      onBack?.();
      return;
    }

    const id = setInterval(() => {
      setTimeLeft((s) => s - 1);
    }, 1000);

    return () => clearInterval(id);
  }, [timeLeft, onBack]);

  const hasSelection = selectedIndices.length > 0;
  const retakesUsed = (localRetaken || []).length;

  const retakesRemaining =
    Number.isFinite(effectiveRetakeLimit) && effectiveRetakeLimit >= 0
      ? Math.max(0, effectiveRetakeLimit - retakesUsed)
      : effectiveRetakeLimit;

  const withinLimit =
    !Number.isFinite(effectiveRetakeLimit) ||
    selectedIndices.length <= retakesRemaining;

  const canRetake =
    hasSelection && withinLimit && (effectiveRetakeLimit ?? 0) !== 0;

  const exceededLimit =
    hasSelection &&
    Number.isFinite(effectiveRetakeLimit) &&
    selectedIndices.length > retakesRemaining;

  const toggleSelection = useCallback(
    (index) => {
      if ((effectiveRetakeLimit ?? 0) === 0) return;

      setSelectedIndices((prev) =>
        prev.includes(index)
          ? prev.filter((i) => i !== index)
          : [...prev, index]
      );
    },
    [effectiveRetakeLimit]
  );

  const persistRetakenIndicesToEvent = useCallback(
    async (indices) => {
      try {
        if (!currentEvent) return false;

        if (window.api?.getEvents && window.api?.setEvents) {
          const all = await window.api.getEvents();
          if (!Array.isArray(all)) return false;

          const updated = (all || []).map((e) => {
            if (e.id === currentEvent.id) {
              return {
                ...e,
                retakenIndices: Array.from(
                  new Set([...(e.retakenIndices || []), ...indices])
                ),
              };
            }
            return e;
          });

          await window.api.setEvents(updated);
          return true;
        }

        if (window.electron?.getEvents && window.electron?.setEvents) {
          const all = await window.electron.getEvents();
          if (!Array.isArray(all)) return false;

          const updated = (all || []).map((e) => {
            if (e.id === currentEvent.id) {
              return {
                ...e,
                retakenIndices: Array.from(
                  new Set([...(e.retakenIndices || []), ...indices])
                ),
              };
            }
            return e;
          });

          await window.electron.setEvents(updated);
          return true;
        }
      } catch (err) {
        console.warn("Failed to persist retaken indices:", err);
      }

      return false;
    },
    [currentEvent]
  );

  const handleRetake = useCallback(() => {
    if (!canRetake) return;

    setLocalRetaken((prev) =>
      Array.from(new Set([...(prev || []), ...selectedIndices]))
    );

    onRetake?.(selectedIndices);
    persistRetakenIndicesToEvent(selectedIndices).catch(() => {});
    setSelectedIndices([]);
  }, [canRetake, onRetake, persistRetakenIndicesToEvent, selectedIndices]);

  const handleConfirm = useCallback(async () => {
    setSaving(true);

    try {
      const updatedPhotos = photos.slice();

      const persistOne = async (i, bridge) => {
        const p = updatedPhotos[i];
        const dataUrl =
          (typeof p === "string" && p.startsWith("data:")) || p?.dataUrl
            ? typeof p === "string"
              ? p
              : p.dataUrl
            : null;

        if (dataUrl) {
          // Save to disk for persistence — but keep the data URL for display so
          // file:// URLs (which may have encoding issues or be blocked in some
          // Electron configurations) never replace the always-working data URL.
          try {
            await bridge({
              eventId: effectiveEventId,
              dataUrl,
              index: i + 1,
              total: updatedPhotos.length,
              timestamp: Date.now(),
            });
          } catch (err) {
            console.warn("capturePhoto persist failed for index", i, err);
          }
          // Always keep the data URL in updatedPhotos for downstream display
          updatedPhotos[i] = dataUrl;
        } else if (typeof p === "string" && p.startsWith("file://")) {
          // already persisted as a file path — keep as-is
        } else if (p?.fileUrl) {
          updatedPhotos[i] = p.fileUrl;
        } else if (p?.filePath) {
          updatedPhotos[i] = `file://${p.filePath}`;
        } else {
          console.warn("Skipping non-data URL photo:", p);
        }
      };

      if (window.api?.capturePhoto) {
        for (let i = 0; i < updatedPhotos.length; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await persistOne(i, window.api.capturePhoto);
        }
      } else if (window.electron?.capturePhoto) {
        for (let i = 0; i < updatedPhotos.length; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await persistOne(i, window.electron.capturePhoto);
        }
      } else {
        console.warn(
          "No capture persistence API available on window.api or window.electron"
        );
      }

      if (selectedIndices.length > 0) {
        await persistRetakenIndicesToEvent(selectedIndices);
      }

      onConfirm?.(updatedPhotos);
    } catch (err) {
      console.error("Failed to save captures:", err);
      onConfirm?.(photos);
    } finally {
      setSaving(false);
    }
  }, [
    effectiveEventId,
    onConfirm,
    persistRetakenIndicesToEvent,
    photos,
    selectedIndices,
  ]);

  const resolvedPhotos = useMemo(() => {
    return photos.map((p, i) => {
      let src = null;

      if (p && typeof p === "object") {
        if (p.fileUrl) {
          src = p.fileUrl;
        } else if (p.filePath) {
          src = p.filePath.startsWith("file://")
            ? p.filePath
            : `file://${p.filePath}`;
        } else if (p.dataUrl) {
          src = p.dataUrl;
        }
      } else if (typeof p === "string") {
        src = p;
      }

      const hasSavedFile =
        (typeof p === "string" && p.startsWith("file://")) ||
        (p && typeof p === "object" && Boolean(p.fileUrl || p.filePath));

      const recordedRetaken = (localRetaken || []).includes(i);
      const isRetaken = recordedRetaken && hasSavedFile;

      return {
        index: i,
        src,
        isRetaken,
        isSelected: selectedIndices.includes(i),
      };
    });
  }, [photos, localRetaken, selectedIndices]);

  const isVideo = (src) =>
    typeof src === "string" &&
    /\.(mp4|webm|ogg|mov)$/i.test(src.split("?")[0]);

  const isGif = (src) =>
    typeof src === "string" && /\.gif$/i.test(src.split("?")[0]);

  const theme = boothTheme({
    bgColor, headerFontColor, generalFontColor, buttonBgColor, buttonHoverColor, buttonFontColor,
    headerFont, generalFont, buttonFont,
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
      style={{
        backgroundColor: bgColor,
        fontFamily: generalFont,
        color: generalFontColor,
      }}
    >
      {/* Top bar: logo + retakes left + timer */}
      <BoothTopBar
        theme={theme}
        logoSrc={logoPath ? normalizeToFileUrl(logoPath) : null}
        logoScale={logoScale}
        name={boothName}
      >
        <BoothChip theme={theme}>
          Retakes left {Number.isFinite(effectiveRetakeLimit) ? retakesRemaining : "∞"}
        </BoothChip>
        <BoothTimer theme={theme} seconds={timeLeft} />
      </BoothTopBar>

      <div className="relative z-20 flex-1 min-h-0 flex flex-col" style={{ padding: "0 clamp(16px, 3vw, 48px) clamp(12px, 2vh, 28px)" }}>
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="w-full max-w-[1500px] h-full flex flex-col overflow-hidden" style={panelStyle(theme)}>
            <div
              className="flex items-center justify-between gap-4"
              style={{ borderBottom: `1px solid ${theme.line}`, padding: "clamp(12px, 1.8vh, 28px) clamp(14px, 2vw, 36px)" }}
            >
              <div className="min-w-0">
                <h2 className="truncate" style={{ ...TYPE.title, fontFamily: headerFont, color: headerFontColor }}>
                  Select photos to retake
                </h2>
                <p style={{ ...TYPE.body, color: theme.muted, marginTop: 4 }}>
                  Tap any photo to mark it for retake, or continue when you&rsquo;re happy with the set.
                </p>
              </div>

              <BoothChip theme={theme}>Selected {selectedIndices.length}</BoothChip>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "clamp(12px, 1.8vh, 36px) clamp(14px, 2vw, 36px)" }}>
              {resolvedPhotos.length > 0 ? (
                <div
                  className={`grid gap-5 ${
                    resolvedPhotos.length <= 2
                      ? "grid-cols-2"
                      : resolvedPhotos.length === 3
                        ? (isPortrait ? "grid-cols-2" : "grid-cols-3")
                        : isTablet
                          ? "grid-cols-3"
                          : "grid-cols-2 xl:grid-cols-4"
                  }`}
                >
                  {resolvedPhotos.map((photo) => (
                    <motion.button
                      key={photo.index}
                      type="button"
                      whileHover={{
                        scale: (effectiveRetakeLimit ?? 0) > 0 ? 1.015 : 1,
                      }}
                      whileTap={{
                        scale: (effectiveRetakeLimit ?? 0) > 0 ? 0.992 : 1,
                      }}
                      onClick={() =>
                        (effectiveRetakeLimit ?? 0) > 0 &&
                        toggleSelection(photo.index)
                      }
                      className={`group relative overflow-hidden text-left transition-all duration-300 ${
                        (effectiveRetakeLimit ?? 0) > 0
                          ? "cursor-pointer"
                          : "cursor-not-allowed opacity-50"
                      }`}
                      style={{
                        borderRadius: RADIUS.tile,
                        border: `${photo.isSelected ? 2 : 1}px solid ${photo.isSelected ? theme.lineStrong : theme.line}`,
                      }}
                    >
                      <div className="relative aspect-[9/6] w-full overflow-hidden" style={{ backgroundColor: theme.surface }}>
                        {photo.src ? (
                          <motion.img
                            src={photo.src}
                            alt={`Captured ${photo.index + 1}`}
                            className="h-full w-full object-cover"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.25 }}
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = "";
                            }}
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-gray-400">
                            No preview
                          </div>
                        )}

                        {photo.isRetaken && (
                          <div className="absolute top-3 right-3">
                            <BoothChip theme={theme} overlay style={{ fontSize: "clamp(11px, 1.1vw, 15px)" }}>
                              Retaken
                            </BoothChip>
                          </div>
                        )}

                        {photo.isSelected && (
                          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "rgba(17, 17, 17, 0.45)" }}>
                            <div
                              className="rounded-full px-5 py-2 text-sm font-bold"
                              style={{
                                backgroundColor: theme.selectedBg,
                                color: theme.selectedText,
                                border: "1px solid rgba(255, 255, 255, 0.7)",
                              }}
                            >
                              Selected
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.button>
                  ))}
                </div>
              ) : (
                <div className="h-full min-h-[320px] flex items-center justify-center">
                  <div className="px-10 py-12 text-center" style={panelStyle(theme)}>
                    <div style={{ ...TYPE.title, color: headerFontColor }}>
                      No photos available
                    </div>
                    <p style={{ ...TYPE.body, color: theme.muted, marginTop: 8 }}>
                      There are no captured photos to review yet.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div
              className="flex flex-col gap-2"
              style={{ borderTop: `1px solid ${theme.line}`, padding: "clamp(10px, 1.4vh, 22px) clamp(14px, 2vw, 36px)" }}
            >
              <div className="flex items-center justify-end gap-3">
                <BoothButton theme={theme} variant="secondary" onClick={handleRetake} disabled={!canRetake}>
                  <ArrowUturnLeftIcon className="h-5 w-5 flex-shrink-0" />
                  {exceededLimit ? "Retake (limit reached)" : "Retake"}
                </BoothButton>

                <BoothButton theme={theme} onClick={handleConfirm} loading={saving}>
                  {!saving && <CheckCircleIcon className="h-5 w-5 flex-shrink-0" />}
                  {saving ? "Saving…" : "Continue"}
                </BoothButton>
              </div>

              {exceededLimit && (
                <p className="text-right" style={{ ...TYPE.caption, color: theme.accent }}>
                  You selected more photos than the remaining retake allowance.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}