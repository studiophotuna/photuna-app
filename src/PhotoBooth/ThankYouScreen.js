
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";
import { useLayout } from "../utils/useLayout";
import { boothTheme, BoothTopBar, BoothTimer, BoothButton, TYPE, SCREEN_MOTION } from "../components/booth/boothUi";

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
      style={{ backgroundColor: theme.bg, color: theme.body, fontFamily: generalFont }}
    >
      <BoothTopBar theme={theme} logoSrc={logoPath} name={boothName}>
        <BoothTimer theme={theme} seconds={countdown} />
      </BoothTopBar>

      <div
        className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center text-center"
        style={{ padding: "0 clamp(20px, 6vw, 96px) 8vh" }}
      >
        <div className="flex flex-col items-center" style={{ width: "100%", maxWidth: 760 }}>
          <h1 style={{ ...TYPE.display, fontFamily: headerFont, color: theme.text }}>
            {t.ready}
          </h1>
          <p style={{ ...TYPE.body, color: theme.muted, marginTop: "clamp(12px, 2vh, 24px)" }}>
            {t.Thankyou}
          </p>
          <BoothButton
            theme={theme}
            size="lg"
            onClick={onRestart}
            style={{ marginTop: "clamp(24px, 4vh, 48px)", minWidth: "min(360px, 80vw)" }}
          >
            {t.newSession}
          </BoothButton>
        </div>
      </div>
    </motion.div>
  );
}