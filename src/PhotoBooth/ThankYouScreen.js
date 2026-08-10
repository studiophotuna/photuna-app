
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";
import { useLayout } from "../utils/useLayout";

function getBridge() {
  if (typeof window === "undefined") return null;
  return window.api ?? window.electron ?? null;
}

/* ---------------------- Appearance defaults ---------------------- */
const DEFAULT_APPEARANCE = {
  boothName: "Studio Photuna",
  // ThankYouScreen accepts either 'tagline' or AdminDashboard's 'boothSlogan'
  tagline: "Ahead of the moment.",
  headerFont: "Ramillas",
  generalFont: "Interphases",
  buttonFont: "Interphases",
  headerFontColor: "#ffffff",
  generalFontColor: "#e5e5e5",
  bgColor: "#000000",
  logoPath: null,
  backgroundMediaPath: null,
  buttonBgColor: "#ec4899",
  buttonHoverColor: "#db2777",
  buttonFontColor: "#ffffff",
};

/* ---------------------- i18n (minimal) ---------------------- */
const LOCALES = {
  en: {
    printed: "Printed",
    done: "Done",
    dotAccent: ".",
    ready: "✨ Your print is ready ✨",
    Thankyou: "Thanks for posing with us! We loved capturing your moment. Enjoy your photo and we hope to see you again soon.",
    returningIn: "returning in",
    seconds: "s",
    newSession: "New Session →",
    by: "by",
  },
  tl: {
    printed: "Na-imprenta",
    done: "Tapos",
    dotAccent: ".",
    ready: "Handa na ang iyong print ✨",
    Thankyou: "Salamat sa pag-pose! ...",
    returningIn: "babalik sa",
    seconds: "seg",
    newSession: "Bagong Sesyon →",
    by: "ng",
  },
};

const LOCALE_ALIASES = { tagalog: 'tl', fil: 'tl', filipino: 'tl' };

function resolveLocale(code) {
  if (!code) return LOCALES.en;
  const key = String(code).toLowerCase();
  const resolved = LOCALE_ALIASES[key] ?? key;
  return LOCALES[resolved] ?? LOCALES.en;
}

/**
 * ThankYouScreen (Ultra Minimal, AdminDashboard-aware, No glass)
 *
 * Props:
 * - eventId (optional) for fetching appearance if event not provided
 * - event (optional) preferred: pass selectedEvent for instant appearance
 * - logo (optional) overrides appearance logo
 * - countdownStart (default 10) final fallback if AdminDashboard timers are missing
 * - onRestart (required)
 */
export default function ThankYouScreen({
  eventId = "default",
  event = null,
  logo = null,
  countdownStart = 10,
  onRestart,
  sessionSummary = null,
}) {
  const api = getBridge();
  const { isPortrait, isUnsupported } = useLayout();

  const [countdown, setCountdown] = useState(countdownStart);
  const [currentEvent, setCurrentEvent] = useState(event ?? null);
  const [globalAppearance, setGlobalAppearance] = useState(null);
  const [globalSettings, setGlobalSettings] = useState(null);
  // Gate countdown start until settings are resolved so the timer never jumps.
  const [settingsLoaded, setSettingsLoaded] = useState(!!event);

  /* ---- Load event + global appearance/settings (fallbacks) ---- */
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (!api) { if (mounted) setSettingsLoaded(true); return; }

        // Prefer event prop (already complete from AdminDashboard)
        if (event) {
          if (mounted) setCurrentEvent(event);
        } else if (api.getEvents) {
          const all = await api.getEvents();
          const found = Array.isArray(all)
            ? all.find((e) => String(e.id) === String(eventId))
            : null;
          if (mounted && found) setCurrentEvent(found);
        }

        if (api.getAppearance) {
          const a = await api.getAppearance();
          if (mounted && a) setGlobalAppearance(a);
        }

        if (api.getSettings) {
          const s = await api.getSettings();
          if (mounted && s) setGlobalSettings(s);
        }
      } catch (err) {
        console.warn("ThankYouScreen: failed to load appearance/event/settings", err);
      } finally {
        if (mounted) setSettingsLoaded(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [api, eventId, event]);

  /* ---- Resolve appearance ---- */
  const appearance = useMemo(() => {
    const evApp = currentEvent?.appearance ?? {};
    const gApp = globalAppearance ?? {};
    const merged = { ...DEFAULT_APPEARANCE, ...gApp, ...evApp };

    // Support AdminDashboard 'boothSlogan' as an alias to 'tagline'
    const resolvedTagline =
      evApp.boothSlogan ?? gApp.boothSlogan ?? merged.tagline ?? null;

    const resolvedLogo = logo ? logo : merged.logoPath;

    return {
      ...merged,
      tagline: resolvedTagline,
      logoPath: resolvedLogo ? normalizeToFileUrl(resolvedLogo) : null,
      backgroundMediaPath: merged.backgroundMediaPath
        ? normalizeToFileUrl(merged.backgroundMediaPath)
        : null,
    };
  }, [currentEvent, globalAppearance, logo]);

  const {
    boothName,
    tagline,
    headerFont,
    generalFont,
    buttonFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    logoPath,
    logoSize,
    backgroundMediaPath,
    buttonBgColor,
    buttonHoverColor,
    buttonFontColor,
  } = appearance;
  const logoScale = (logoSize ?? 100) / 100;

  /* ---- Resolve language ---- */
  const langCode =
    currentEvent?.settings?.language ??
    globalSettings?.language ??
    "en";
  const t = resolveLocale(langCode);

  /* ---- Resolve ThankYou countdown from AdminDashboard timers ---- */
  const thankyouSeconds =
    currentEvent?.settings?.screenTimers?.thankyou ??
    globalSettings?.screenTimers?.thankyou ??
    countdownStart; // final fallback

  /* ---- Load fonts ---- */
  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);

  /* ---- Countdown (starts only after settings are resolved) ---- */
  useEffect(() => {
    if (!settingsLoaded) return;

    const n = Number(thankyouSeconds);
    const start = Number.isFinite(n) && n > 0 ? n : countdownStart;
    setCountdown(start);

    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          onRestart?.();
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [settingsLoaded, thankyouSeconds, onRestart, countdownStart]);

  const isGif =
    !!backgroundMediaPath && backgroundMediaPath.toLowerCase().endsWith(".gif");

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
      className={`relative w-full h-screen overflow-hidden ${isPortrait ? "flex flex-col" : "flex items-center justify-center"}`}
      style={{
        backgroundColor: bgColor,
        color: generalFontColor,
        fontFamily: generalFont,
      }}
    >

      {/* Portrait Row 1: logo + countdown */}
      {isPortrait && (
        <div className="shrink-0 flex items-center justify-between z-30" style={{ padding: '2vh 4vw' }}>
          {logoPath
            ? <img src={logoPath} alt="logo" style={{ maxHeight: `${Math.round(60 * logoScale)}px` }} className="w-auto object-contain" />
            : <span className="font-bold" style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(18px, 2.5vw, 46px)' }}>{boothName}</span>
          }
          <div className="px-5 py-2 rounded-full font-bold shadow-sm" style={{ backgroundColor: buttonBgColor, color: buttonFontColor, fontFamily: generalFont, fontSize: 'clamp(16px, 2vw, 38px)' }} aria-live="polite">
            {countdown}{t.seconds}
          </div>
        </div>
      )}

      {/* Single centered section — portrait: flex child; landscape: full centered block */}
      <motion.div
        className={`relative z-10 text-center px-6 ${isPortrait ? "flex-1 min-h-0 flex flex-col items-center justify-center" : "flex flex-col items-center justify-center w-[92vw] max-w-2xl"}`}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >

        {/* Logo / booth name — landscape only (portrait shows it in the header row) */}
        {!isPortrait && (
          <div className="mb-6">
            {logoPath ? (
              <img src={logoPath} alt="logo" style={{ maxHeight: `${Math.round(64 * logoScale)}px` }} className="w-auto object-contain mx-auto" />
            ) : (
              <>
                <p className="font-bold" style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(18px, 2.5vw, 40px)' }}>{boothName}</p>
                {tagline && <p style={{ color: generalFontColor, fontSize: 'clamp(12px, 1.2vw, 20px)' }}>{tagline}</p>}
              </>
            )}
          </div>
        )}

        <h1
          className="font-extrabold tracking-tight"
          style={{ fontFamily: headerFont, color: headerFontColor, fontSize: isPortrait ? 'clamp(28px, 4vw, 76px)' : 'clamp(24px, 3.5vw, 60px)', whiteSpace: "nowrap" }}
        >
          {t.ready}
        </h1>

        <p className="mt-6 opacity-75" style={{ fontSize: isPortrait ? 'clamp(14px, 1.8vw, 34px)' : 'clamp(13px, 1.4vw, 22px)' }}>{t.Thankyou}</p>

        {!isPortrait && (
          <p className="mt-4 opacity-50" style={{ fontSize: 'clamp(12px, 1.2vw, 18px)' }}>
            {t.returningIn}{" "}
            <span className="font-bold opacity-80">{countdown}{t.seconds}</span>
          </p>
        )}

        <motion.button
          onClick={onRestart}
          whileTap={{ scale: 0.98 }}
          className="mt-6 w-full py-4 text-xl max-w-sm rounded-full font-bold"
          style={{
            backgroundColor: buttonBgColor,
            color: buttonFontColor,
            fontFamily: buttonFont,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor =
              buttonHoverColor || buttonBgColor;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = buttonBgColor;
          }}
        >
          {t.newSession}
        </motion.button>
      </motion.div>
    </div>
  );
}