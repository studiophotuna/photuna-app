import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";
import { DEFAULT_APPEARANCE } from "../utils/appearance";
import { useLayout } from "../utils/useLayout";
import { formatRetention } from "../utils/galleryRetention";
import {
  boothTheme,
  BoothButton,
  BoothTopBar,
  BoothTimer,
  SCREEN_MOTION,
  TYPE,
  RADIUS,
  panelStyle,
  withAlpha,
  logoOnEveryScreen,
} from "../components/booth/boothUi";

const CONSENT_VERSION = "1.0";
const IDLE_SECONDS = 20;
// An operator's disclaimer can be long; give guests time to read it.
const DISCLAIMER_IDLE_SECONDS = 60;

export default function ConsentScreen({ event = null, eventConfig = {}, galleryAvailable = true, disclaimer = null, retentionDays = 7, onAccept, onDecline }) {
  const { isPortrait } = useLayout();
  const idleSeconds = disclaimer ? DISCLAIMER_IDLE_SECONDS : IDLE_SECONDS;
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(idleSeconds);
  const [agreed, setAgreed] = useState(false);
  const mustAgree = Boolean(disclaimer?.requireAgreement);

  const cfg = event?.config ?? eventConfig ?? {};
  const appearance = event?.appearance ?? {};

  const rawLogo = appearance?.logoPath ?? "";
  const logo = normalizeToFileUrl(rawLogo);
  const centerLogo = normalizeToFileUrl(eventConfig?.centerLogo || "");
  const selectedLogo = logo || centerLogo || "";

  const eventName = appearance?.boothName ?? cfg?.eventName ?? "Studio Photuna";

  const bgColor       = appearance?.bgColor             ?? "#000000";
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

  const theme = boothTheme({
    bgColor, headerFontColor, generalFontColor, buttonBgColor, buttonHoverColor, buttonFontColor,
    headerFont, generalFont, buttonFont,
  });

  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);

  const resetIdle = useCallback(() => {
    setIdleSecondsLeft(idleSeconds);
  }, [idleSeconds]);

  useEffect(() => {
    setIdleSecondsLeft(idleSeconds);
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
  }, [onDecline, idleSeconds]);

  const handleAccept = () => {
    if (mustAgree && !agreed) return;
    onAccept?.({
      consentVersion: CONSENT_VERSION,
      consentedAt: new Date().toISOString(),
      // The exact wording agreed to is recorded with the consent.
      disclaimer: disclaimer ? { title: disclaimer.title, text: disclaimer.text } : null,
    });
  };

  /* What happens to a guest's photos, and what they can do about it afterwards.
     These used to sit behind a "Privacy details" toggle, which made sense in a
     narrow column: on a booth screen there is room to simply show them, and
     consent information a guest has to go looking for is worth less. */
  const facts = [
    {
      label: "Printed",
      text: "Your photo is printed here at the booth and handed to you.",
    },
    galleryAvailable
      ? {
          label: "Kept",
          text: `Your gallery link works for ${formatRetention(retentionDays)}. Your photos are then deleted from our servers.`,
        }
      : {
          label: "Kept",
          text: "Storage and access are managed by the booth operator.",
        },
    {
      label: "Never sold",
      text: "Your photos are not sold or shared with third parties.",
    },
    {
      label: "Removal",
      text: galleryAvailable
        ? <>Request removal at <ExternalLink theme={theme} href="https://www.studiophotuna.com/privacy-request">studiophotuna.com/privacy-request</ExternalLink> or email <span style={{ color: theme.accent }}>{contactEmail}</span>.</>
        : operatorEmail
          ? <>Contact the booth operator or email <span style={{ color: theme.accent }}>{operatorEmail}</span> to request removal.</>
          : "Contact the booth operator to request removal.",
    },
    {
      label: "Withdrawal",
      text: "You may withdraw consent after your session. It does not affect photos already printed.",
    },
    {
      label: "Full policy",
      text: galleryAvailable
        ? <>Processed by Studio Photuna for the event operator &middot; <ExternalLink theme={theme} href="https://www.studiophotuna.com/privacy-framework">privacy policy</ExternalLink></>
        : <>Managed directly by the booth operator &middot; <ExternalLink theme={theme} href="https://www.studiophotuna.com/privacy-framework">privacy policy</ExternalLink></>,
    },
  ];

  const showLogo = logoOnEveryScreen(event);
  const twoUp = !isPortrait;

  return (
    <motion.div
      key="consent"
      {...SCREEN_MOTION}
      className="relative w-full h-screen flex flex-col"
      style={{ backgroundColor: theme.bg, fontFamily: theme.fonts.body, color: theme.body }}
      onPointerMove={resetIdle}
      onPointerDown={resetIdle}
      onKeyDown={resetIdle}
    >
      <BoothTopBar theme={theme} logoSrc={selectedLogo} name={eventName} showLogo={showLogo}>
        <BoothTimer theme={theme} seconds={idleSecondsLeft} />
      </BoothTopBar>

      {/* The screen itself does not scroll; the disclaimer scrolls inside its own
          panel, so the buttons never leave the guest's reach. Portrait stacks and
          may scroll, because a tall booth screen has the room for it. */}
      <div
        className="flex-1 min-h-0 w-full flex flex-col items-center"
        style={{
          overflowY: isPortrait ? "auto" : "hidden",
          padding: "0 clamp(16px, 3vw, 48px) clamp(28px, 6vh, 72px)",
        }}
        onScroll={resetIdle}
      >
        <div
          className="w-full flex flex-col min-h-0"
          // The question, the detail and the buttons sit together as one group in
          // the middle of the screen, so the buttons are not pushed to the bottom edge.
          style={{
            maxWidth: "min(1180px, 84vw)",
            gap: "clamp(20px, 3.6vh, 48px)",
            flex: 1,
            justifyContent: "safe center",
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="min-h-0"
            style={{
              flex: "0 1 auto",
              display: "grid",
              gridTemplateColumns: twoUp ? "minmax(0, 1fr) minmax(0, 1.05fr)" : "minmax(0, 1fr)",
              gap: "clamp(16px, 2.5vw, 44px)",
              alignItems: twoUp ? "center" : "start",
            }}
          >
            {/* ---- the ask ---- */}
            <div className="flex flex-col min-w-0" style={{ gap: "clamp(10px, 1.6vh, 20px)" }}>
              <h1
                style={{
                  ...TYPE.title,
                  fontFamily: theme.fonts.header,
                  color: theme.text,
                  textWrap: "balance",
                  margin: 0,
                }}
              >
                Allow {eventName} to capture and print your photo?
              </h1>

              <p style={{ ...TYPE.body, color: theme.muted, margin: 0, maxWidth: "42ch" }}>
                {galleryAvailable
                  ? "Take a few photos, get them printed, and open your own gallery link afterwards. Here is exactly what happens to them."
                  : "Take a few photos and get them printed here at the booth. Here is exactly what happens to them."}
              </p>

              {!twoUp ? null : (
                <p style={{ ...TYPE.caption, color: theme.muted, margin: 0, opacity: 0.75, maxWidth: "42ch" }}>
                  {disclaimer
                    ? "By tapping Allow you consent to photo capture and storage as described, and to the terms shown."
                    : "By tapping Allow you consent to photo capture and storage as described."}
                </p>
              )}
            </div>

            {/* ---- the detail ---- */}
            <div
              className="flex flex-col min-h-0 min-w-0"
              style={{ gap: "clamp(12px, 1.8vh, 20px)", maxHeight: twoUp ? "100%" : undefined }}
            >
              {disclaimer && (
                <section
                  style={panelStyle(theme, {
                    padding: "clamp(14px, 2vh, 24px) clamp(16px, 1.8vw, 28px)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "clamp(8px, 1.2vh, 14px)",
                    minHeight: 0,
                  })}
                >
                  <SectionLabel theme={theme}>{disclaimer.title}</SectionLabel>
                  <div
                    onScroll={resetIdle}
                    style={{
                      ...TYPE.caption,
                      maxHeight: twoUp ? "min(32vh, 320px)" : "26vh",
                      overflowY: "auto",
                      whiteSpace: "pre-wrap",
                      color: theme.body,
                      paddingRight: 8,
                    }}
                  >
                    {disclaimer.text}
                  </div>

                  {mustAgree && (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={agreed}
                      onClick={() => { resetIdle(); setAgreed((a) => !a); }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "clamp(10px, 1vw, 16px)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        color: theme.text,
                        padding: "clamp(6px, 1vh, 10px) 0 0",
                        ...TYPE.caption,
                        fontWeight: 600,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          flexShrink: 0,
                          width: "clamp(30px, 3.2vw, 44px)",
                          height: "clamp(30px, 3.2vw, 44px)",
                          borderRadius: RADIUS.tile,
                          border: `2px solid ${agreed ? theme.accent : theme.line}`,
                          backgroundColor: agreed ? theme.accent : "transparent",
                          color: theme.accentText,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 800,
                          fontSize: "clamp(16px, 1.8vw, 24px)",
                          transition: "background-color 160ms ease, border-color 160ms ease",
                        }}
                      >
                        {agreed ? "✓" : ""}
                      </span>
                      <span>{disclaimer.agreementLabel}</span>
                    </button>
                  )}
                </section>
              )}

              <section
                style={panelStyle(theme, {
                  padding: "clamp(14px, 2vh, 24px) clamp(16px, 1.8vw, 28px)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "clamp(8px, 1.2vh, 14px)",
                  minHeight: 0,
                })}
              >
                <SectionLabel theme={theme}>What happens to your photos</SectionLabel>
                <dl
                  style={{
                    margin: 0,
                    display: "grid",
                    gridTemplateColumns: "auto minmax(0, 1fr)",
                    columnGap: "clamp(12px, 1.4vw, 22px)",
                    rowGap: "clamp(7px, 1.1vh, 13px)",
                    alignItems: "baseline",
                    overflowY: "auto",
                    minHeight: 0,
                  }}
                >
                  {facts.map(({ label, text }) => (
                    <React.Fragment key={label}>
                      <dt
                        style={{
                          ...TYPE.caption,
                          color: theme.muted,
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          fontSize: "clamp(9px, 0.85vw, 12px)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {label}
                      </dt>
                      <dd style={{ ...TYPE.caption, color: theme.body, margin: 0 }}>{text}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </section>
            </div>
          </motion.div>

          {/* ---- the decision ---- */}
          <div className="shrink-0 flex flex-col" style={{ gap: "clamp(8px, 1.2vh, 14px)" }}>
            <div
              style={{
                display: "grid",
                // Equal weight on purpose: the accent colour already marks the
                // primary action, and shrinking "Don't allow" to make Allow look
                // easier is not a choice a consent screen should make for someone.
                gridTemplateColumns: twoUp ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)",
                gap: "clamp(10px, 1.2vw, 20px)",
              }}
            >
              <BoothButton
                theme={theme}
                variant="secondary"
                size="lg"
                fullWidth
                onClick={onDecline}
                style={{ minHeight: "clamp(58px, 8vh, 92px)", order: twoUp ? 0 : 1 }}
              >
                Don&rsquo;t allow
              </BoothButton>

              <BoothButton
                theme={theme}
                size="lg"
                fullWidth
                onClick={handleAccept}
                disabled={mustAgree && !agreed}
                style={{ minHeight: "clamp(58px, 8vh, 92px)", order: twoUp ? 1 : 0 }}
              >
                {mustAgree && !agreed ? "Tick the box to continue" : "Allow"}
              </BoothButton>
            </div>

            {twoUp ? null : (
              <p style={{ ...TYPE.caption, color: theme.muted, margin: 0, opacity: 0.75, textAlign: "center" }}>
                {disclaimer
                  ? "By tapping Allow you consent to photo capture and storage as described, and to the terms shown."
                  : "By tapping Allow you consent to photo capture and storage as described."}
              </p>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** A quiet heading for one section of the consent screen. */
function SectionLabel({ theme, children }) {
  return (
    <div
      style={{
        fontFamily: theme.fonts.header,
        color: theme.text,
        fontWeight: 700,
        fontSize: "clamp(14px, 1.3vw, 22px)",
        lineHeight: 1.25,
        paddingBottom: "clamp(6px, 0.9vh, 10px)",
        borderBottom: `1px solid ${withAlpha(theme.body, 0.12, theme.line)}`,
      }}
    >
      {children}
    </div>
  );
}

function ExternalLink({ theme, href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: theme.accent, textDecoration: "underline" }}
    >
      {children}
    </a>
  );
}
