// src/components/booth/boothUi.js
//
// The shared look of the guest-facing booth screens: one top bar, one timer, one
// button, one panel and selection style, one text scale and one screen
// transition.
//
// Every colour comes from the event's appearance, and the neutral tones (lines,
// surfaces, muted text) adapt to whether the booth background is light or dark.
// Screens should use these instead of hard-coding pink, indigo, greys or heavy
// shadows of their own — that mix is what made the booth feel like several
// different apps.

import React, { useState } from "react";
import { motion } from "framer-motion";

/* ------------------------------ colour helpers ------------------------------ */

function parseColor(color) {
  const c = String(color || "").trim();
  let m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) return m[1].split("").map((h) => parseInt(h + h, 16));
  m = c.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** The colour at the given opacity; the fallback is used for colours we cannot read. */
export function withAlpha(color, alpha, fallback = `rgba(0, 0, 0, ${alpha})`) {
  const rgb = parseColor(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : fallback;
}

export function isLightColor(color) {
  const rgb = parseColor(color);
  if (!rgb) return false;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

/* ---------------------------------- tokens ---------------------------------- */

/** Colours and fonts for one screen, from the merged event/global appearance. */
export function boothTheme(appearance = {}) {
  const bg = appearance.bgColor || "#000000";
  const light = isLightColor(bg);
  const text = appearance.headerFontColor || (light ? "#111111" : "#ffffff");
  const body = appearance.generalFontColor || (light ? "#374151" : "#e5e5e5");
  const accent = appearance.buttonBgColor || "#ec4899";
  return {
    light,
    bg,
    text,
    body,
    muted: withAlpha(body, 0.68, light ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.68)"),
    accent,
    accentHover: appearance.buttonHoverColor || accent,
    accentText: appearance.buttonFontColor || "#ffffff",
    line: light ? "rgba(0, 0, 0, 0.12)" : "rgba(255, 255, 255, 0.22)",
    lineStrong: light ? "rgba(0, 0, 0, 0.6)" : "rgba(255, 255, 255, 0.7)",
    surface: light ? "rgba(0, 0, 0, 0.03)" : "rgba(255, 255, 255, 0.06)",
    surfaceHover: light ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.1)",
    selectedBg: "rgba(17, 17, 17, 0.88)",
    selectedText: "#ffffff",
    fonts: {
      header: appearance.headerFont,
      body: appearance.generalFont,
      button: appearance.buttonFont || appearance.generalFont,
    },
  };
}

/** The booth's text scale. Spread into a style, then add the font and colour. */
export const TYPE = {
  display: { fontSize: "clamp(32px, 4.2vw, 76px)", lineHeight: 1.05, letterSpacing: "-0.02em", fontWeight: 700 },
  title: { fontSize: "clamp(22px, 2.4vw, 42px)", lineHeight: 1.15, letterSpacing: "-0.01em", fontWeight: 700 },
  body: { fontSize: "clamp(14px, 1.5vw, 24px)", lineHeight: 1.5 },
  caption: { fontSize: "clamp(11px, 1.1vw, 16px)", lineHeight: 1.4 },
};

export const RADIUS = { control: 999, card: 20, tile: 12 };

/** The one screen transition: a quick fade. Spread onto a motion element. */
export const SCREEN_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.3, ease: "easeOut" },
};

/** A panel or card: a faint surface with a thin border and no shadow. */
export function panelStyle(theme, extra = {}) {
  return {
    backgroundColor: theme.surface,
    border: `1px solid ${theme.line}`,
    borderRadius: RADIUS.card,
    ...extra,
  };
}

/** Anything a guest picks from a set: thin border when not chosen, dark background when chosen. */
export function selectionStyle(theme, isActive) {
  return {
    backgroundColor: isActive ? theme.selectedBg : theme.surface,
    color: isActive ? theme.selectedText : theme.text,
    border: `1px solid ${isActive ? theme.lineStrong : theme.line}`,
  };
}

/* -------------------------------- components -------------------------------- */

/** Logo (or booth name) on the left, status chips such as the timer on the right. */
export function BoothTopBar({ theme, logoSrc = null, logoScale = 1, name = "", children, style }) {
  return (
    <div
      className="shrink-0 flex items-center justify-between"
      style={{
        position: "relative",
        zIndex: 20,
        gap: 16,
        padding: "clamp(12px, 2vh, 28px) clamp(16px, 3vw, 48px)",
        ...style,
      }}
    >
      <div className="min-w-0 flex items-center">
        {logoSrc ? (
          <img
            src={logoSrc}
            alt={name || "logo"}
            className="object-contain"
            style={{ maxHeight: Math.round(52 * logoScale), maxWidth: "40vw" }}
          />
        ) : (
          <span
            className="truncate"
            style={{ fontFamily: theme.fonts.header, color: theme.text, fontWeight: 700, fontSize: "clamp(18px, 2vw, 34px)" }}
          >
            {name}
          </span>
        )}
      </div>
      <div className="flex items-center shrink-0" style={{ gap: 10 }}>{children}</div>
    </div>
  );
}

/**
 * A small status pill: thin outline, no fill. `accent` draws attention (a timer
 * running out); `overlay` is for content over the live camera image.
 */
export function BoothChip({ theme, children, accent = false, overlay = false, style, ...rest }) {
  const color = overlay ? "#ffffff" : accent ? theme.accent : theme.text;
  return (
    <div
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.45em",
        borderRadius: RADIUS.control,
        padding: "clamp(6px, 0.8vh, 12px) clamp(12px, 1.4vw, 22px)",
        fontFamily: theme.fonts.body,
        fontWeight: 600,
        fontSize: "clamp(13px, 1.5vw, 24px)",
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1,
        whiteSpace: "nowrap",
        color,
        backgroundColor: overlay ? "rgba(0, 0, 0, 0.35)" : "transparent",
        border: `1px solid ${overlay ? "rgba(255, 255, 255, 0.35)" : accent ? withAlpha(theme.accent, 0.6, theme.line) : theme.line}`,
        backdropFilter: overlay ? "blur(8px)" : undefined,
        WebkitBackdropFilter: overlay ? "blur(8px)" : undefined,
        transition: "color 200ms ease, border-color 200ms ease",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The screen timer, the same everywhere. Turns to the accent colour for the last five seconds. */
export function BoothTimer({ theme, seconds, overlay = false }) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return (
    <BoothChip theme={theme} accent={s > 0 && s <= 5} overlay={overlay} aria-live="polite" aria-label={`${s} seconds left`}>
      <svg width="0.95em" height="0.95em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.75 }}>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 2M9 2h6" />
      </svg>
      <span>{s}s</span>
    </BoothChip>
  );
}

/** A loading spinner in the brand colour. */
export function BoothSpinner({ theme, size = 28, color }) {
  const c = color || theme.accent;
  const width = typeof size === "number" ? Math.max(2, Math.round(size / 9)) : "0.15em";
  return (
    <span
      role="status"
      aria-label="Loading"
      className="animate-spin"
      style={{
        display: "inline-block",
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: RADIUS.control,
        border: `${typeof width === "number" ? `${width}px` : width} solid ${withAlpha(c, 0.2)}`,
        borderTopColor: c,
      }}
    />
  );
}

const BUTTON_SIZES = {
  md: { padding: "clamp(10px, 1.3vh, 16px) clamp(20px, 2.2vw, 36px)", fontSize: "clamp(14px, 1.5vw, 22px)" },
  lg: { padding: "clamp(14px, 1.8vh, 24px) clamp(28px, 3vw, 52px)", fontSize: "clamp(16px, 1.9vw, 30px)" },
};

/**
 * The booth button. primary: brand colour; secondary: thin outline; ghost: text
 * only. One shape and one press effect everywhere.
 */
export function BoothButton({
  theme,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  fullWidth = false,
  children,
  style,
  onMouseEnter,
  onMouseLeave,
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const inactive = disabled || loading;

  const variants = {
    primary: {
      backgroundColor: hover && !inactive ? theme.accentHover : theme.accent,
      color: theme.accentText,
      border: "1px solid transparent",
    },
    secondary: {
      backgroundColor: hover && !inactive ? theme.surfaceHover : "transparent",
      color: theme.text,
      border: `1px solid ${theme.line}`,
    },
    ghost: {
      backgroundColor: "transparent",
      color: theme.muted,
      border: "1px solid transparent",
    },
  };

  return (
    <motion.button
      type="button"
      disabled={inactive}
      whileTap={inactive ? undefined : { scale: 0.97 }}
      onMouseEnter={(e) => { setHover(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHover(false); onMouseLeave?.(e); }}
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5em",
        width: fullWidth ? "100%" : undefined,
        borderRadius: RADIUS.control,
        fontFamily: theme.fonts.button,
        fontWeight: 700,
        letterSpacing: "-0.01em",
        lineHeight: 1.1,
        cursor: inactive ? "not-allowed" : "pointer",
        opacity: inactive ? 0.5 : 1,
        transition: "background-color 160ms ease, opacity 160ms ease",
        ...BUTTON_SIZES[size],
        ...variants[variant],
        ...style,
      }}
    >
      {loading && (
        <BoothSpinner theme={theme} size="1em" color={variant === "primary" ? theme.accentText : theme.accent} />
      )}
      {children}
    </motion.button>
  );
}
