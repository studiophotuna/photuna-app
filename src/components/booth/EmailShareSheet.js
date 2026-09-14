// src/components/booth/EmailShareSheet.js
//
// "Email me my photos" on the print screen. The address goes into the booth's
// outbox (see src/services/guestOutbox.js), so it is accepted even with no
// internet and sent when the booth reconnects. The sheet closes itself when the
// guest walks away.

import React, { useEffect, useRef, useState } from "react";
import OnScreenKeyboard from "./OnScreenKeyboard";
import { isValidEmail } from "../../utils/guestExperience";

const IDLE_CLOSE_MS = 45_000;

const COPY = {
  en: {
    title: "Email me my photos",
    hint: "Type your email and we'll send you the link to your gallery.",
    privacy: "We only use this address to send your gallery link.",
    placeholder: "you@example.com",
    send: "Send",
    close: "Close",
    invalid: "That doesn't look like an email address. Please check it.",
    sending: "Saving…",
    sent: "Done! Your link is on its way. Check your inbox (and spam folder) in a few minutes.",
    queued: "Saved! We'll email your link as soon as the booth is back online.",
    another: "Send to another address",
    limit: "This gallery has been sent to the maximum number of addresses.",
    failed: "We couldn't save that address. Please try again.",
  },
  tl: {
    title: "I-email ang aking mga litrato",
    hint: "I-type ang iyong email at ipapadala namin ang link ng iyong gallery.",
    privacy: "Ginagamit namin ang address na ito para ipadala ang link ng gallery.",
    placeholder: "ikaw@example.com",
    send: "Ipadala",
    close: "Isara",
    invalid: "Hindi wasto ang email address. Pakisuri.",
    sending: "Sine-save…",
    sent: "Tapos! Parating ang iyong link. Tingnan ang inbox (at spam) sa loob ng ilang minuto.",
    queued: "Na-save! Ipapadala namin ang link kapag muling online ang booth.",
    another: "Ipadala sa ibang address",
    limit: "Naipadala na ang gallery na ito sa pinakamaraming address.",
    failed: "Hindi na-save ang address. Pakisubukang muli.",
  },
};

export default function EmailShareSheet({
  open,
  onClose,
  onSubmit, // async (email) => { ok, error? }
  remaining = 1,
  offline = false,
  lang = "en",
  accent = "#ec4899",
  accentText = "#ffffff",
  headerFont,
  bodyFont,
}) {
  const t = /^(tl|fil)/i.test(String(lang || "")) ? COPY.tl : COPY.en;
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | done
  const [error, setError] = useState("");
  const idleRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setStatus("idle");
    setError("");
  }, [open]);

  // Close when nobody has touched the sheet for a while.
  useEffect(() => {
    if (!open) return undefined;
    clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => onClose?.(), IDLE_CLOSE_MS);
    return () => clearTimeout(idleRef.current);
  }, [open, email, status, onClose]);

  if (!open) return null;

  const submit = async () => {
    if (status === "sending") return;
    const value = email.trim();
    if (!isValidEmail(value)) {
      setError(t.invalid);
      return;
    }
    setError("");
    setStatus("sending");
    try {
      const res = await onSubmit?.(value);
      if (res?.ok) {
        setStatus("done");
      } else {
        setStatus("idle");
        setError(t.failed);
      }
    } catch {
      setStatus("idle");
      setError(t.failed);
    }
  };

  const panel = {
    width: "min(94vw, 900px)",
    background: "#ffffff",
    color: "#111827",
    borderRadius: 24,
    padding: "clamp(16px, 2.4vw, 32px)",
    boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
    fontFamily: bodyFont,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 12,
        padding: "clamp(12px, 2vh, 24px)",
      }}
    >
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <div style={{ fontFamily: headerFont, fontSize: "clamp(22px, 3vw, 40px)", fontWeight: 700, lineHeight: 1.1 }}>{t.title}</div>
            {status !== "done" && (
              <div style={{ marginTop: 6, fontSize: "clamp(13px, 1.6vw, 20px)", color: "#4b5563" }}>{t.hint}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ fontSize: "clamp(14px, 1.6vw, 20px)", fontWeight: 600, color: "#374151", background: "#f3f4f6", border: "none", borderRadius: 999, padding: "10px 18px" }}
          >
            {t.close}
          </button>
        </div>

        {status === "done" ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: "clamp(16px, 2vw, 26px)", lineHeight: 1.5 }}>{offline ? t.queued : t.sent}</div>
            <div style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
              {remaining > 0 ? (
                <button
                  type="button"
                  onClick={() => { setEmail(""); setStatus("idle"); }}
                  style={{ background: accent, color: accentText, border: "none", borderRadius: 999, padding: "14px 24px", fontSize: "clamp(15px, 1.8vw, 22px)", fontWeight: 700 }}
                >
                  {t.another}
                </button>
              ) : (
                <div style={{ fontSize: "clamp(13px, 1.5vw, 18px)", color: "#6b7280" }}>{t.limit}</div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                marginTop: 16,
                minHeight: "clamp(52px, 7vh, 84px)",
                display: "flex",
                alignItems: "center",
                borderRadius: 16,
                border: `2px solid ${error ? "#ef4444" : accent}`,
                padding: "0 18px",
                fontSize: "clamp(18px, 2.6vw, 36px)",
                wordBreak: "break-all",
                color: email ? "#111827" : "#9ca3af",
              }}
            >
              {email || t.placeholder}
              <span style={{ display: "inline-block", width: 2, height: "1.1em", marginLeft: 2, background: accent, animation: "pulse 1s infinite" }} />
            </div>
            {error && <div style={{ marginTop: 8, color: "#dc2626", fontSize: "clamp(13px, 1.5vw, 18px)" }}>{error}</div>}
            <div style={{ marginTop: 10, fontSize: "clamp(11px, 1.3vw, 16px)", color: "#6b7280" }}>{t.privacy}</div>
          </>
        )}
      </div>

      {status !== "done" && (
        <div style={{ width: "min(94vw, 900px)" }}>
          <OnScreenKeyboard
            mode="email"
            value={email}
            onChange={(v) => { setEmail(v); if (error) setError(""); }}
            onDone={submit}
            doneLabel={status === "sending" ? t.sending : t.send}
            maxLength={254}
            accent={accent}
            accentText={accentText}
            font={bodyFont}
          />
        </div>
      )}
    </div>
  );
}
