// src/PhotoBooth/SurveyScreen.js
//
// The optional guest survey, shown after printing and before the thank-you
// screen. Everything is optional unless the operator marked a question
// required, and a guest who walks away is never left on this screen: after a
// short idle period it moves on with whatever was answered.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { loadGoogleFont } from "../utils/fontLoader";
import { DEFAULT_APPEARANCE } from "../utils/appearance";
import { MAX_TEXT_ANSWER_CHARS, fallbackCopy } from "../utils/guestExperience";
import OnScreenKeyboard from "../components/booth/OnScreenKeyboard";

const IDLE_SECONDS = 30;

const COPY = {
  en: {
    submit: "Submit",
    skip: "Skip",
    optional: "optional",
    tapToType: "Tap to type your answer",
    done: "Done",
    continuing: (s) => `Continuing in ${s}s`,
    stars: (n) => `${n} star${n === 1 ? "" : "s"}`,
  },
  tl: {
    submit: "Isumite",
    skip: "Laktawan",
    optional: "opsyonal",
    tapToType: "I-tap para mag-type",
    done: "Tapos",
    continuing: (s) => `Magpapatuloy sa ${s}s`,
    stars: (n) => `${n} bituin`,
  },
};

export default function SurveyScreen({ event = null, title = "", questions = [], lang = "en", onDone }) {
  const t = /^(tl|fil)/i.test(String(lang || "")) ? COPY.tl : COPY.en;
  const appearance = event?.appearance ?? {};
  const bgColor = appearance.bgColor ?? "#000000";
  const headerFont = appearance.headerFont ?? DEFAULT_APPEARANCE.headerFont ?? "Ramillas";
  const generalFont = appearance.generalFont ?? DEFAULT_APPEARANCE.generalFont ?? "Interphases";
  const buttonFont = appearance.buttonFont || generalFont;
  const headerFontColor = appearance.headerFontColor ?? "#ffffff";
  const generalFontColor = appearance.generalFontColor ?? "#e5e5e5";
  const accent = appearance.buttonBgColor || "#ec4899";
  const accentText = appearance.buttonFontColor || "#ffffff";

  const [answers, setAnswers] = useState({});
  const [typingId, setTypingId] = useState(null);
  const [idleLeft, setIdleLeft] = useState(IDLE_SECONDS);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);

  const collected = useMemo(
    () => questions
      .filter((q) => answers[q.id] !== undefined && String(answers[q.id]).trim() !== "")
      .map((q) => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        value: q.type === "text" ? String(answers[q.id]).trim() : answers[q.id],
      })),
    [questions, answers]
  );

  const requiredMissing = questions.some(
    (q) => q.required && (answers[q.id] === undefined || String(answers[q.id]).trim() === "")
  );

  const finish = useCallback((list) => {
    setFinished((already) => {
      if (!already) onDone?.(list);
      return true;
    });
  }, [onDone]);

  const touch = useCallback(() => setIdleLeft(IDLE_SECONDS), []);

  // Walking away keeps what was answered; nothing is thrown away.
  useEffect(() => {
    if (finished) return undefined;
    const tick = setInterval(() => {
      setIdleLeft((s) => {
        if (s <= 1) {
          clearInterval(tick);
          finish(collected);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [finished, finish, collected]);

  const setAnswer = (id, value) => {
    touch();
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const typingQuestion = questions.find((q) => q.id === typingId) || null;
  const heading = title.trim() || fallbackCopy(lang).surveyTitle;
  const muted = "rgba(255,255,255,0.55)";

  return (
    <motion.div
      key="survey"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="relative w-full h-screen overflow-y-auto flex flex-col items-center"
      style={{ backgroundColor: bgColor, color: generalFontColor, fontFamily: generalFont }}
      onPointerDown={touch}
    >
      <div
        className="my-auto w-full"
        style={{ maxWidth: "min(92vw, 760px)", padding: "clamp(24px, 4vh, 56px) clamp(16px, 4vw, 40px)", paddingBottom: typingQuestion ? "48vh" : undefined }}
      >
        <h1
          className="text-center font-bold"
          style={{ fontFamily: headerFont, color: headerFontColor, fontSize: "clamp(26px, 4vw, 52px)", lineHeight: 1.1, marginBottom: "clamp(20px, 3.5vh, 40px)" }}
        >
          {heading}
        </h1>

        <div style={{ display: "flex", flexDirection: "column", gap: "clamp(18px, 3vh, 34px)" }}>
          {questions.map((q, index) => (
            <div key={q.id}>
              <div style={{ fontSize: "clamp(16px, 2.2vw, 28px)", fontWeight: 600, color: headerFontColor, marginBottom: 10 }}>
                {index + 1}. {q.prompt}
                {!q.required && (
                  <span style={{ marginLeft: 8, fontSize: "0.65em", fontWeight: 500, color: muted }}>({t.optional})</span>
                )}
              </div>

              {q.type === "rating" && (
                <div style={{ display: "flex", gap: "clamp(6px, 1vw, 14px)" }}>
                  {[1, 2, 3, 4, 5].map((n) => {
                    const active = Number(answers[q.id]) >= n;
                    return (
                      <button
                        key={n}
                        type="button"
                        aria-label={t.stars(n)}
                        onClick={() => setAnswer(q.id, n)}
                        style={{
                          flex: 1,
                          minHeight: "clamp(52px, 7vh, 88px)",
                          borderRadius: 16,
                          border: `2px solid ${active ? accent : "rgba(255,255,255,0.2)"}`,
                          background: active ? accent : "rgba(255,255,255,0.06)",
                          color: active ? accentText : generalFontColor,
                          fontSize: "clamp(24px, 3.4vw, 44px)",
                          lineHeight: 1,
                        }}
                      >
                        ★
                      </button>
                    );
                  })}
                </div>
              )}

              {q.type === "choice" && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "clamp(8px, 1vw, 12px)" }}>
                  {q.options.map((option) => {
                    const active = answers[q.id] === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setAnswer(q.id, active ? undefined : option)}
                        style={{
                          borderRadius: 999,
                          padding: "clamp(10px, 1.4vh, 16px) clamp(16px, 2.2vw, 28px)",
                          border: `2px solid ${active ? accent : "rgba(255,255,255,0.2)"}`,
                          background: active ? accent : "rgba(255,255,255,0.06)",
                          color: active ? accentText : generalFontColor,
                          fontFamily: buttonFont,
                          fontSize: "clamp(14px, 1.9vw, 24px)",
                          fontWeight: 600,
                        }}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              )}

              {q.type === "text" && (
                <button
                  type="button"
                  onClick={() => { touch(); setTypingId(q.id); }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    minHeight: "clamp(52px, 7vh, 84px)",
                    borderRadius: 16,
                    padding: "12px 18px",
                    border: `2px solid ${typingId === q.id ? accent : "rgba(255,255,255,0.2)"}`,
                    background: "rgba(255,255,255,0.06)",
                    color: answers[q.id] ? generalFontColor : muted,
                    fontSize: "clamp(15px, 2vw, 26px)",
                    wordBreak: "break-word",
                  }}
                >
                  {answers[q.id] || t.tapToType}
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: "clamp(24px, 4vh, 48px)", display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            disabled={requiredMissing || collected.length === 0}
            onClick={() => finish(collected)}
            style={{
              width: "100%",
              borderRadius: 18,
              padding: "clamp(14px, 2vh, 22px)",
              border: "none",
              background: accent,
              color: accentText,
              fontFamily: buttonFont,
              fontSize: "clamp(16px, 2.2vw, 26px)",
              fontWeight: 700,
              opacity: requiredMissing || collected.length === 0 ? 0.45 : 1,
            }}
          >
            {t.submit}
          </button>
          <button
            type="button"
            onClick={() => finish([])}
            style={{ width: "100%", padding: 12, background: "transparent", border: "none", color: muted, fontFamily: buttonFont, fontSize: "clamp(14px, 1.8vw, 22px)" }}
          >
            {t.skip}
          </button>
          <div className="text-center" style={{ fontSize: "clamp(11px, 1.3vw, 14px)", color: muted }}>
            {t.continuing(idleLeft)}
          </div>
        </div>
      </div>

      {typingQuestion && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60, padding: "clamp(8px, 1.5vh, 16px)", display: "flex", justifyContent: "center" }}>
          <div style={{ width: "min(96vw, 900px)" }}>
            <div style={{ background: "#ffffff", color: "#111827", borderRadius: 16, padding: "12px 18px", marginBottom: 8, fontSize: "clamp(15px, 2vw, 26px)", minHeight: 52, wordBreak: "break-word" }}>
              {answers[typingQuestion.id] || <span style={{ color: "#9ca3af" }}>{typingQuestion.prompt}</span>}
            </div>
            <OnScreenKeyboard
              mode="text"
              value={answers[typingQuestion.id] || ""}
              onChange={(v) => setAnswer(typingQuestion.id, v)}
              onDone={() => setTypingId(null)}
              doneLabel={t.done}
              maxLength={MAX_TEXT_ANSWER_CHARS}
              accent={accent}
              accentText={accentText}
              font={generalFont}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}
