import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";
import { DEFAULT_APPEARANCE } from "../utils/appearance";
import { useLayout } from "../utils/useLayout";

const CONSENT_VERSION = "1.0";
const IDLE_SECONDS = 20;

export default function ConsentScreen({ event = null, eventConfig = {}, galleryAvailable = true, onAccept, onDecline }) {
  const { isPortrait } = useLayout();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(IDLE_SECONDS);

  const cfg = event?.config ?? eventConfig ?? {};
  const appearance = event?.appearance ?? {};

  const rawLogo = appearance?.logoPath ?? "";
  const logo = normalizeToFileUrl(rawLogo);
  const centerLogo = normalizeToFileUrl(eventConfig?.centerLogo || "");
  const selectedLogo = logo || centerLogo || "";
  const logoScale = (appearance?.logoSize ?? 100) / 100;

  const eventName = appearance?.boothName ?? cfg?.eventName ?? "Studio Photuna";

  const bgColor       = appearance?.bgColor            ?? "#000000";
  const headerFont    = appearance?.headerFont          ?? DEFAULT_APPEARANCE.headerFont ?? "Ramillas";
  const generalFont   = appearance?.generalFont         ?? DEFAULT_APPEARANCE.generalFont ?? "Interphases";
  const buttonFont    = appearance?.buttonFont          || generalFont;
  const headerFontColor  = appearance?.headerFontColor  ?? "#ffffff";
  const generalFontColor = appearance?.generalFontColor ?? "#e5e5e5";
  const buttonBgColor    = appearance?.buttonBgColor    || "#ec4899";
  const buttonHoverColor = appearance?.buttonHoverColor || "#db2777";
  const buttonFontColor  = appearance?.buttonFontColor  || "#ffffff";
  const operatorEmail = appearance?.contactEmail         || "";
  const contactEmail  = operatorEmail                    || "support@studiophotuna.com";
  const retentionDays = cfg?.galleryRetentionDays       || 7;

  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);

  const resetIdle = useCallback(() => {
    setIdleSecondsLeft(IDLE_SECONDS);
  }, []);

  useEffect(() => {
    setIdleSecondsLeft(IDLE_SECONDS);
    const tick = setInterval(() => {
      setIdleSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(tick);
          onDecline?.();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [onDecline]);

  const handleAccept = () => {
    onAccept?.({ consentVersion: CONSENT_VERSION, consentedAt: new Date().toISOString() });
  };

  const mutedColor   = `rgba(${hexToRgb(generalFontColor)}, 0.55)`;
  const dividerColor = `rgba(${hexToRgb(generalFontColor)}, 0.12)`;

  const maxW = isPortrait ? "min(88vw, 420px)" : "min(72vw, 480px)";

  return (
    <motion.div
      key="consent"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="relative w-full h-screen overflow-y-auto flex flex-col items-center"
      style={{ backgroundColor: bgColor, fontFamily: generalFont, color: generalFontColor }}
      onPointerMove={resetIdle}
      onPointerDown={resetIdle}
      onKeyDown={resetIdle}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="my-auto"
        style={{ width: "100%", maxWidth: maxW, padding: "clamp(24px, 4vh, 48px) clamp(20px, 5vw, 40px)" }}
      >
        {/* Logo or camera mark */}
        <div className="flex justify-center mb-6">
          {selectedLogo ? (
            <img
              src={selectedLogo}
              alt={eventName}
              className="object-contain"
              style={{ maxHeight: `${Math.round(80 * logoScale)}px`, maxWidth: `${Math.round(260 * logoScale)}px` }}
            />
          ) : (
            <div
              className="flex items-center justify-center rounded-2xl"
              style={{
                width: "clamp(52px, 8vw, 72px)",
                height: "clamp(52px, 8vw, 72px)",
                backgroundColor: `rgba(${hexToRgb(generalFontColor)}, 0.1)`,
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke={headerFontColor}
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: "clamp(26px, 4vw, 36px)", height: "clamp(26px, 4vw, 36px)", opacity: 0.7 }}
              >
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
            fontSize: "clamp(22px, 3.8vw, 38px)",
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            marginBottom: "clamp(12px, 2vh, 20px)",
          }}
        >
          Allow {eventName} to capture and print your photo?
        </h1>

        {/* Body — one clean paragraph */}
        <p
          className="text-center"
          style={{
            fontSize: "clamp(13px, 1.8vw, 18px)",
            lineHeight: 1.65,
            color: mutedColor,
            marginBottom: "clamp(8px, 1.5vh, 16px)",
          }}
        >
          {galleryAvailable ? (
            <>
              Your photos will be captured, printed, and stored securely for{" "}
              <span style={{ color: generalFontColor, fontWeight: 600 }}>
                {retentionDays} day{retentionDays !== 1 ? "s" : ""}
              </span>
              {" "}so you can access your gallery link. They won't be sold or shared with third parties.
            </>
          ) : (
            <>
              Your photos will be captured and printed. Storage and access to your photos are managed by the booth operator. Photos won't be sold or shared with third parties.
            </>
          )}
        </p>

        {/* Privacy details toggle */}
        <div className="flex justify-center" style={{ marginBottom: "clamp(20px, 3.5vh, 36px)" }}>
          <button
            onClick={() => setDetailsOpen((o) => !o)}
            className="flex items-center gap-1 transition-opacity hover:opacity-80"
            style={{
              fontSize: "clamp(12px, 1.5vw, 15px)",
              color: buttonBgColor,
              fontWeight: 600,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 0",
            }}
          >
            Privacy details
            <motion.svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ width: 13, height: 13 }}
              animate={{ rotate: detailsOpen ? 180 : 0 }}
              transition={{ duration: 0.22 }}
            >
              <path d="M4 6l4 4 4-4" />
            </motion.svg>
          </button>
        </div>

        {/* Expandable legal details */}
        <AnimatePresence initial={false}>
          {detailsOpen && (
            <motion.div
              key="details"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              style={{ overflow: "hidden" }}
            >
              <div
                style={{
                  borderTop: `1px solid ${dividerColor}`,
                  borderBottom: `1px solid ${dividerColor}`,
                  padding: "clamp(14px, 2.5vh, 22px) 0",
                  marginBottom: "clamp(16px, 2.5vh, 28px)",
                }}
              >
                {[
                  {
                    label: "Deletion",
                    text: galleryAvailable ? (
                      <>
                        Request removal at{" "}
                        <a
                          href="https://www.studiophotuna.com/privacy-request"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: buttonBgColor, textDecoration: "underline" }}
                        >
                          studiophotuna.com/privacy-request
                        </a>{" "}
                        or email{" "}
                        <span style={{ color: buttonBgColor }}>{contactEmail}</span>.
                      </>
                    ) : operatorEmail ? (
                      <>
                        Contact the booth operator or email{" "}
                        <span style={{ color: buttonBgColor }}>{operatorEmail}</span>{" "}
                        to request removal.
                      </>
                    ) : (
                      "Contact the booth operator to request removal."
                    ),
                  },
                  {
                    label: "Withdrawal",
                    text: "You may withdraw this consent after your session. Withdrawal does not affect photos already printed.",
                  },
                  {
                    label: "Controller",
                    text: galleryAvailable
                      ? "Photos are processed by Studio Photuna on behalf of the event operator."
                      : "Photos are managed directly by the booth operator.",
                  },
                  {
                    label: "Full policy",
                    text: (
                      <a
                        href="https://www.studiophotuna.com/privacy-framework"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: buttonBgColor, textDecoration: "underline" }}
                      >
                        studiophotuna.com/privacy-framework
                      </a>
                    ),
                  },
                ].map(({ label, text }) => (
                  <div
                    key={label}
                    className="flex gap-3"
                    style={{ marginBottom: "clamp(8px, 1.4vh, 14px)", fontSize: "clamp(11px, 1.4vw, 14px)", lineHeight: 1.6 }}
                  >
                    <span
                      style={{
                        color: mutedColor,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        fontSize: "clamp(9px, 1.1vw, 11px)",
                        flexShrink: 0,
                        paddingTop: "0.2em",
                        width: "clamp(56px, 7vw, 72px)",
                      }}
                    >
                      {label}
                    </span>
                    <span style={{ color: mutedColor }}>{text}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 1.4vh, 14px)" }}>
          <motion.button
            onClick={handleAccept}
            whileTap={{ scale: 0.975 }}
            className="w-full font-semibold transition-colors"
            style={{
              borderRadius: "clamp(12px, 2vw, 18px)",
              padding: "clamp(14px, 2vh, 22px) clamp(24px, 4vw, 40px)",
              fontSize: "clamp(15px, 2vw, 22px)",
              fontFamily: buttonFont,
              backgroundColor: buttonBgColor,
              color: buttonFontColor,
              border: "none",
              cursor: "pointer",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = buttonHoverColor)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = buttonBgColor)}
          >
            Allow
          </motion.button>

          <button
            onClick={onDecline}
            className="w-full font-medium transition-opacity hover:opacity-70"
            style={{
              borderRadius: "clamp(12px, 2vw, 18px)",
              padding: "clamp(12px, 1.6vh, 18px) clamp(24px, 4vw, 40px)",
              fontSize: "clamp(13px, 1.7vw, 19px)",
              fontFamily: buttonFont,
              color: mutedColor,
              backgroundColor: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            Don't Allow
          </button>
        </div>

        {/* Idle countdown */}
        <div
          className="flex flex-col items-center"
          style={{ marginTop: "clamp(16px, 2.8vh, 28px)", gap: 8 }}
        >
          {/* Track */}
          <div
            style={{
              width: "clamp(120px, 20vw, 180px)",
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
              fontSize: "clamp(10px, 1.2vw, 12px)",
              color: idleSecondsLeft <= 5
                ? "#ef4444"
                : mutedColor,
              lineHeight: 1.5,
              opacity: 0.75,
            }}
          >
            {idleSecondsLeft <= 5
              ? `Returning in ${idleSecondsLeft}s…`
              : `Screen returns automatically in ${idleSecondsLeft}s`}
          </p>
        </div>

        {/* Micro legal note */}
        <p
          className="text-center"
          style={{
            marginTop: "clamp(8px, 1.2vh, 14px)",
            fontSize: "clamp(10px, 1.2vw, 12px)",
            color: mutedColor,
            lineHeight: 1.5,
            opacity: 0.7,
          }}
        >
          By tapping Allow, you consent to photo capture and storage as described.
        </p>
      </motion.div>
    </motion.div>
  );
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
