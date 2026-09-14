// src/components/booth/OnScreenKeyboard.js
//
// A touch keyboard for booth screens. A full-screen kiosk window gets no
// Windows touch keyboard, and many booths have no physical one, so anything a
// guest types (an email address, a survey answer) goes through this.

import React, { useState } from "react";

const LETTER_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

export default function OnScreenKeyboard({
  value = "",
  onChange,
  onDone,
  mode = "text", // "email" | "text"
  maxLength = 254,
  doneLabel = "Done",
  accent = "#ec4899",
  accentText = "#ffffff",
  font,
}) {
  // Short answers start with a capital, like a phone keyboard; emails never do.
  const [shift, setShift] = useState(mode === "text" && !value);

  const insert = (chars) => {
    onChange?.(`${value}${chars}`.slice(0, maxLength));
    if (shift) setShift(false);
  };
  const backspace = () => onChange?.(value.slice(0, -1));

  const keyStyle = (flex = 1, highlighted = false) => ({
    flex,
    minWidth: 0,
    minHeight: "clamp(44px, 6.2vh, 76px)",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: highlighted ? accent : "rgba(255,255,255,0.12)",
    color: highlighted ? accentText : "#ffffff",
    fontFamily: font,
    fontSize: "clamp(16px, 2.3vw, 30px)",
    fontWeight: 600,
    touchAction: "manipulation",
    userSelect: "none",
  });

  // Acting on pointer-down keeps typing quick and never steals focus.
  const press = (fn) => (e) => {
    e.preventDefault();
    fn();
  };

  const letter = (ch) => {
    const out = shift ? ch.toUpperCase() : ch;
    return (
      <button key={ch} type="button" style={keyStyle()} onPointerDown={press(() => insert(out))}>
        {out}
      </button>
    );
  };

  const row = (children, key) => (
    <div key={key} style={{ display: "flex", gap: "clamp(4px, 0.6vw, 8px)" }}>
      {children}
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "clamp(4px, 0.6vw, 8px)",
        padding: "clamp(8px, 1.2vw, 16px)",
        background: "rgba(10,10,12,0.92)",
        borderRadius: 20,
      }}
    >
      {LETTER_ROWS.map((chars, i) => row([...chars].map(letter), `r${i}`))}

      {mode === "email"
        ? row(
          [
            ...["@", ".", "_", "-"].map((ch) => (
              <button key={ch} type="button" style={keyStyle()} onPointerDown={press(() => insert(ch))}>{ch}</button>
            )),
            <button key=".com" type="button" style={keyStyle(1.6)} onPointerDown={press(() => insert(".com"))}>.com</button>,
            <button key="@gmail" type="button" style={keyStyle(2.6)} onPointerDown={press(() => insert("@gmail.com"))}>@gmail.com</button>,
          ],
          "email-extras"
        )
        : row(
          [
            <button key="shift" type="button" style={keyStyle(1.4, shift)} onPointerDown={press(() => setShift((s) => !s))} aria-label="Shift">⇧</button>,
            ...[",", "'"].map((ch) => (
              <button key={ch} type="button" style={keyStyle()} onPointerDown={press(() => insert(ch))}>{ch}</button>
            )),
            <button key="space" type="button" style={keyStyle(4)} onPointerDown={press(() => insert(" "))} aria-label="Space">␣</button>,
            ...[".", "!", "?"].map((ch) => (
              <button key={ch} type="button" style={keyStyle()} onPointerDown={press(() => insert(ch))}>{ch}</button>
            )),
          ],
          "text-extras"
        )}

      {row(
        [
          <button key="backspace" type="button" style={keyStyle(1.5)} onPointerDown={press(backspace)} aria-label="Backspace">⌫</button>,
          <button key="done" type="button" style={keyStyle(2, true)} onPointerDown={press(() => onDone?.())}>{doneLabel}</button>,
        ],
        "actions"
      )}
    </div>
  );
}
