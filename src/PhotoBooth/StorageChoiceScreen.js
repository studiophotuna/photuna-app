import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";
import { DEFAULT_APPEARANCE } from "../utils/appearance";
import { useLayout } from "../utils/useLayout";

const IDLE_SECONDS = 20;

export default function StorageChoiceScreen({
  event = null,
  eventConfig = {},
  operatorStorage = {},
  cloudStorage = {},
  galleryOptionDisabled = false,
  onSelect,
}) {
  const { isPortrait } = useLayout();
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(IDLE_SECONDS);
  const [choosing, setChoosing] = useState(null);

  const cfg = event?.config ?? eventConfig ?? {};
  const appearance = event?.appearance ?? {};

  const rawLogo = appearance?.logoPath ?? "";
  const logo = normalizeToFileUrl(rawLogo);
  const centerLogo = normalizeToFileUrl(eventConfig?.centerLogo || "");
  const selectedLogo = logo || centerLogo || "";

  const rawBoothName = appearance?.boothName || cfg?.eventName || "";
  const eventName = rawBoothName || "Studio Photuna";
  const folderLabel = rawBoothName ? `${rawBoothName} Photos` : "Photos";
  const retentionDays = cfg?.galleryRetentionDays || 7;

  const bgColor = appearance?.bgColor ?? "#000000";
  const headerFont = appearance?.headerFont ?? DEFAULT_APPEARANCE.headerFont ?? "Ramillas";
  const generalFont = appearance?.generalFont ?? DEFAULT_APPEARANCE.generalFont ?? "Interphases";
  const buttonFont = appearance?.buttonFont || generalFont;
  const headerFontColor = appearance?.headerFontColor ?? "#ffffff";
  const generalFontColor = appearance?.generalFontColor ?? "#e5e5e5";
  const buttonBgColor = appearance?.buttonBgColor || "#ec4899";
  const buttonFontColor = appearance?.buttonFontColor || "#ffffff";

  const { enabled: opEnabled, label: opLabel = "Our Storage" } = operatorStorage;
  const showOperator     = Boolean(opEnabled);
  const showGoogleDrive  = Boolean(cloudStorage?.googleDrive?.connected);
  const showDropbox      = Boolean(cloudStorage?.dropbox?.connected);
  const showGallery      = !galleryOptionDisabled;

  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);

  const defaultMode = showGallery ? "system" : showGoogleDrive ? "google-drive" : showDropbox ? "dropbox" : "none";

  useEffect(() => {
    setIdleSecondsLeft(IDLE_SECONDS);
    const tick = setInterval(() => {
      setIdleSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(tick);
          onSelect?.(defaultMode);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [onSelect, defaultMode]);

  const handleSelect = (mode) => {
    setChoosing(mode);
    setTimeout(() => onSelect?.(mode), 180);
  };

  const mutedColor = `rgba(${hexToRgb(generalFontColor)}, 0.55)`;
  const dividerColor = `rgba(${hexToRgb(generalFontColor)}, 0.10)`;
  const maxW = isPortrait ? "min(88vw, 440px)" : "min(74vw, 520px)";

  const options = [
    ...(showGallery ? [{
      mode: "system",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "clamp(22px, 3vw, 28px)", height: "clamp(22px, 3vw, 28px)" }}>
          <path d="M3 15a4 4 0 0 0 4 4h9a5 5 0 1 0-.1-9.999 5.002 5.002 0 0 0-9.78 2.096A4.001 4.001 0 0 0 3 15z" />
        </svg>
      ),
      title: `${eventName} Gallery`,
      description: `Scan a QR code to view and download photos for ${retentionDays} day${retentionDays !== 1 ? "s" : ""}`,
      primary: true,
    }] : []),
    ...(showGoogleDrive ? [{
      mode: "google-drive",
      icon: (
        <svg viewBox="0 0 87.3 78" style={{ width: "clamp(22px, 3vw, 28px)", height: "clamp(22px, 3vw, 28px)" }} xmlns="http://www.w3.org/2000/svg">
          <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
          <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
          <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
          <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
          <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
          <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
        </svg>
      ),
      title: "Save to Google Drive",
      description: `Photo saved to Google Drive — ${folderLabel}`,
      primary: !showGallery,
    }] : []),
    ...(showDropbox ? [{
      mode: "dropbox",
      icon: (
        <svg viewBox="0 0 40 36" style={{ width: "clamp(22px, 3vw, 28px)", height: "clamp(22px, 3vw, 28px)" }} xmlns="http://www.w3.org/2000/svg">
          <path d="M10 0L0 6.5l10 6.5 10-6.5zM30 0L20 6.5l10 6.5 10-6.5zM0 19.5L10 26l10-6.5L10 13zM30 13l-10 6.5L30 26l10-6.5zM10 28.3L20 34.8l10-6.5-10-6.5z" fill="#0061FE"/>
        </svg>
      ),
      title: "Save to Dropbox",
      description: `Photo saved to Dropbox — ${folderLabel}`,
      primary: !showGallery && !showGoogleDrive,
    }] : []),
    ...(showOperator ? [{
      mode: "operator",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "clamp(22px, 3vw, 28px)", height: "clamp(22px, 3vw, 28px)" }}>
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      ),
      title: opLabel,
      description: "Photos sent to the operator's own storage",
      primary: false,
    }] : []),
    {
      mode: "none",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "clamp(22px, 3vw, 28px)", height: "clamp(22px, 3vw, 28px)" }}>
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
      ),
      title: "Print only",
      description: "Just print — no photo saved online",
      primary: false,
    },
  ];

  return (
    <motion.div
      key="storage-choice"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="relative w-full h-screen overflow-y-auto flex flex-col items-center"
      style={{ backgroundColor: bgColor, fontFamily: generalFont, color: generalFontColor }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="my-auto"
        style={{ width: "100%", maxWidth: maxW, padding: "clamp(24px, 4vh, 48px) clamp(20px, 5vw, 40px)" }}
      >
        {/* Logo */}
        <div className="flex justify-center mb-6">
          {selectedLogo ? (
            <img
              src={selectedLogo}
              alt={eventName}
              className="object-contain"
              style={{ maxHeight: "clamp(44px, 9vh, 72px)", maxWidth: "clamp(120px, 50vw, 240px)" }}
            />
          ) : (
            <div
              className="flex items-center justify-center rounded-2xl"
              style={{
                width: "clamp(48px, 7vw, 64px)",
                height: "clamp(48px, 7vw, 64px)",
                backgroundColor: `rgba(${hexToRgb(generalFontColor)}, 0.1)`,
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke={headerFontColor} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
                style={{ width: "clamp(24px, 4vw, 32px)", height: "clamp(24px, 4vw, 32px)", opacity: 0.7 }}>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>
          )}
        </div>

        {/* Title */}
        <h1
          className="text-center font-bold"
          style={{
            fontFamily: headerFont,
            color: headerFontColor,
            fontSize: "clamp(20px, 3.4vw, 34px)",
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            marginBottom: "clamp(6px, 1.2vh, 12px)",
          }}
        >
          Where should we save your photos?
        </h1>

        <p
          className="text-center"
          style={{
            fontSize: "clamp(12px, 1.6vw, 16px)",
            color: mutedColor,
            marginBottom: "clamp(20px, 3vh, 32px)",
            lineHeight: 1.6,
          }}
        >
          Choose how your photos are stored after printing.
        </p>

        {/* Option cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 1.4vh, 14px)" }}>
          {options.map(({ mode, icon, title, description, primary }) => {
            const isSelecting = choosing === mode;
            return (
              <motion.button
                key={mode}
                onClick={() => handleSelect(mode)}
                whileTap={{ scale: 0.975 }}
                animate={isSelecting ? { opacity: 0.6 } : { opacity: 1 }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "clamp(12px, 2vw, 18px)",
                  width: "100%",
                  borderRadius: "clamp(14px, 2.2vw, 20px)",
                  padding: "clamp(14px, 2.2vh, 22px) clamp(18px, 3vw, 26px)",
                  backgroundColor: primary
                    ? buttonBgColor
                    : `rgba(${hexToRgb(generalFontColor)}, 0.08)`,
                  border: primary
                    ? "none"
                    : `1px solid ${dividerColor}`,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ color: primary ? buttonFontColor : generalFontColor, opacity: primary ? 1 : 0.7, flexShrink: 0 }}>
                  {icon}
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: buttonFont,
                      color: primary ? buttonFontColor : headerFontColor,
                      fontSize: "clamp(14px, 1.9vw, 20px)",
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                      lineHeight: 1.2,
                    }}
                  >
                    {title}
                  </div>
                  <div
                    style={{
                      fontSize: "clamp(11px, 1.3vw, 14px)",
                      color: primary ? `rgba(${hexToRgb(buttonFontColor)}, 0.75)` : mutedColor,
                      marginTop: 3,
                      lineHeight: 1.5,
                    }}
                  >
                    {description}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Idle countdown */}
        <div className="flex flex-col items-center" style={{ marginTop: "clamp(18px, 3vh, 30px)", gap: 8 }}>
          <div
            style={{
              width: "clamp(100px, 16vw, 160px)",
              height: 3,
              borderRadius: 999,
              background: `rgba(${hexToRgb(generalFontColor)}, 0.12)`,
              overflow: "hidden",
            }}
          >
            <motion.div
              style={{
                height: "100%",
                borderRadius: 999,
                background: idleSecondsLeft <= 5 ? "#ef4444" : mutedColor,
                originX: 0,
              }}
              animate={{ scaleX: idleSecondsLeft / IDLE_SECONDS }}
              transition={{ duration: 0.9, ease: "linear" }}
            />
          </div>
          <p
            style={{
              fontSize: "clamp(10px, 1.1vw, 12px)",
              color: idleSecondsLeft <= 5 ? "#ef4444" : mutedColor,
              opacity: 0.75,
            }}
          >
            {idleSecondsLeft <= 5
              ? `Saving to gallery in ${idleSecondsLeft}s…`
              : `Auto-saves to gallery in ${idleSecondsLeft}s`}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function hexToRgb(hex) {
  const clean = (hex || "#e5e5e5").replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const n = parseInt(full, 16) || 0;
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
