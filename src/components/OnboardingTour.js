/**
 * OnboardingTour — custom lightweight tour (no react-joyride).
 *
 * nav on a step means: "when the user clicks Next →, navigate to this section
 * so the NEXT step's target is visible."  It never refers to the current step's
 * own section — that's why Events nav has nav:"events" (Create Event needs it)
 * but Home nav has no nav (Events nav is always in the sidebar regardless).
 *
 * Non-interactive steps: 4-div frame + transparent click-blocker over the
 * spotlight hole — the element is visible but not clickable.
 * Interactive steps (create-event form): 4-div frame only, hole is fully live.
 */
import React, { useState, useLayoutEffect, useRef, useMemo } from "react";

const TOOLTIP_W = 400;
const GAP       = 14;
const PAD       = 10;

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

const P = ({ children, style }) => (
  <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "#374151", margin: 0, ...style }}>
    {children}
  </p>
);

const Hint = ({ children }) => (
  <p style={{
    marginTop: 12, marginBottom: 0, padding: "8px 11px",
    background: "#eff6ff", borderRadius: 8,
    fontSize: 12.5, color: "#1d4ed8", lineHeight: 1.5,
  }}>
    {children}
  </p>
);

const Chips = ({ items }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
    {items.map(item => (
      <span key={item} style={{
        padding: "3px 10px", background: "#f0f9ff",
        border: "1px solid #bae6fd", borderRadius: 20,
        fontSize: 11.5, color: "#0369a1", fontWeight: 500,
      }}>
        {item}
      </span>
    ))}
  </div>
);

// ─── Steps ────────────────────────────────────────────────────────────────────
//
// target       — selector to spotlight, or null for a centred modal.
// placement    — "right" | "left" | "top" | "bottom" | "center".
// nav          — section to open on Next click, so the NEXT step's target is live.
// interactive  — 4-div overlay only (hole is clickable). Default: false.
// requireEvent — Next is disabled until eventsCount > 0.

function buildSteps(eventsCount) {
  const n = eventsCount;

  return [
    /* 0 — Home nav
       Next step is Home content (null/centred) which needs the home
       section visible → nav:"home" opens it before advancing. */
    {
      target: "#nav-home",
      placement: "right",
      nav: "home",
      title: "Home",
      content: (
        <div>
          <P>Welcome to <strong>Studio Photuna</strong> — your photo booth management hub.
            Home is your central starting point for the whole application.</P>
          <Hint>Click <strong>Next →</strong> to open Home.</Hint>
        </div>
      ),
    },

    /* 1 — Home content (centred modal shown while Home section is live)
       Next step is Events nav — always in sidebar → no nav needed. */
    {
      target: null,
      placement: "center",
      title: "Inside Home",
      content: (
        <div>
          <P>The Home dashboard gives you a quick overview of your account — recent
            activity, subscription status, and shortcuts to your most-used features.</P>
          <Chips items={["Recent activity", "Subscription", "Quick access"]} />
          <Hint>Click <strong>Next →</strong> to continue.</Hint>
        </div>
      ),
    },

    /* 2 — Events nav
       Next step is Create Event (#create-event-section) which lives inside
       the events section → nav:"events" opens it before advancing. */
    {
      target: "#nav-events",
      placement: "right",
      nav: "events",
      title: "Events",
      content: (
        <div>
          <P><strong>Events</strong> is where you manage all your photo booth sessions.
            Create, view, and organise your events from here.</P>
          <Hint>Click <strong>Next →</strong> to open Events.</Hint>
        </div>
      ),
    },

    /* 2 — Create Event (interactive: form must be usable)
       Next step is Event Library — still in events section, no nav needed. */
    {
      target: "#create-event-section",
      placement: "bottom",
      interactive: true,
      requireEvent: true,
      title: "Create a new event",
      content: (
        <div>
          <P>Give your event a name, set a date, and choose a currency — then click{" "}
            <strong>Create Event</strong> to add it to your library.</P>
          {n > 0
            ? <Hint>✅ You have {n} event{n !== 1 ? "s" : ""}. Click <strong>Next →</strong> to continue.</Hint>
            : <Hint>⬆️ Fill in the form and click <strong>Create Event</strong> to unlock the next step.</Hint>
          }
        </div>
      ),
    },

    /* 3 — Event Library
       Next step is Settings nav — always in sidebar → no nav needed. */
    {
      target: "#event-library",
      placement: "top",
      title: "Event library",
      content: (
        <div>
          <P>All your events appear here. Each card shows key details — templates,
            layouts, and revenue. Open any event with <strong>Open editor</strong> to
            jump into its full workspace.</P>
          <Hint>Click <strong>Next →</strong> to continue.</Hint>
        </div>
      ),
    },

    /* 4 — Settings nav
       Next step is Settings content (null/centred) which needs the settings
       section visible → nav:"settings" opens it before advancing. */
    {
      target: "#nav-settings",
      placement: "right",
      nav: "settings",
      title: "Settings",
      content: (
        <div>
          <P>Configure how your Studio Photuna system works — device connections
            and system-wide preferences for your photo booth.</P>
          <Chips items={["Camera", "Printer", "Storage", "System"]} />
          <Hint>Click <strong>Next →</strong> to open Settings.</Hint>
        </div>
      ),
    },

    /* 5 — Settings content (centred modal shown while Settings section is live)
       Next step is Reports nav — always in sidebar → no nav needed. */
    {
      target: null,
      placement: "center",
      title: "Inside Settings",
      content: (
        <div>
          <P>Here you can connect your camera and printer, set a default storage
            path, and adjust system-wide preferences that apply across all events.</P>
          <Chips items={["Camera setup", "Printer config", "Storage path", "System options"]} />
          <Hint>Click <strong>Next →</strong> to continue.</Hint>
        </div>
      ),
    },

    /* 6 — Reports nav
       Next step is Reports content → nav:"reports" opens the section first. */
    {
      target: "#nav-reports",
      placement: "right",
      nav: "reports",
      title: "Reports",
      content: (
        <div>
          <P>Track performance across your events — revenue, guest counts, and
            session trends so you always know how your business is doing.</P>
          <Chips items={["Revenue", "Sessions", "Guests", "Trends"]} />
          <Hint>Click <strong>Next →</strong> to open Reports.</Hint>
        </div>
      ),
    },

    /* 7 — Reports content (centred modal while Reports section is live)
       Next step is Help Center nav — always in sidebar → no nav needed. */
    {
      target: null,
      placement: "center",
      title: "Inside Reports",
      content: (
        <div>
          <P>Reports gives you a clear picture of your event activity. Review totals
            by date range, compare sessions, and export data for your records.</P>
          <Chips items={["Date filter", "Per-event totals", "Session count", "Export"]} />
          <Hint>Click <strong>Next →</strong> to continue.</Hint>
        </div>
      ),
    },

    /* 8 — Help Center nav
       Next step is Done (null/centred) — no section needed → no nav. */
    {
      target: "#nav-helpcenter",
      placement: "right",
      title: "Help Center",
      content: (
        <div>
          <P>Stuck? The <strong>Help Center</strong> has guides, FAQs, and support
            contacts whenever you need assistance.</P>
          <Hint>Click <strong>Next →</strong> to finish the tour.</Hint>
        </div>
      ),
    },

    /* 9 — Done */
    {
      target: null,
      placement: "center",
      title: "You're all set! 🎉",
      content: (
        <div>
          <P>That's a quick look at Studio Photuna. You're ready to start setting
            up your events and capturing memories.</P>
          <P style={{ marginTop: 8, color: "#6b7280", fontSize: 12.5 }}>
            You can replay this tour any time from the{" "}
            <strong>Take a tour</strong> button in the sidebar.
          </P>
        </div>
      ),
    },
  ];
}

// ─── Positioning ──────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

function placeTip(placement, sp, th, ww, wh) {
  switch (placement) {
    case "right":
      return {
        left: Math.min(sp.x + sp.w + GAP, ww - TOOLTIP_W - 12),
        top:  clamp(sp.y + sp.h / 2 - th / 2, 12, wh - th - 12),
      };
    case "left":
      return {
        left: Math.max(12, sp.x - TOOLTIP_W - GAP),
        top:  clamp(sp.y + sp.h / 2 - th / 2, 12, wh - th - 12),
      };
    case "top":
      return {
        left: clamp(sp.x + sp.w / 2 - TOOLTIP_W / 2, 12, ww - TOOLTIP_W - 12),
        top:  Math.max(12, sp.y - th - GAP),
      };
    case "bottom":
      return {
        left: clamp(sp.x + sp.w / 2 - TOOLTIP_W / 2, 12, ww - TOOLTIP_W - 12),
        top:  Math.min(sp.y + sp.h + GAP, wh - th - 12),
      };
    default:
      return { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingTour({
  run,
  eventsCount = 0,
  currentSection,
  onNavigate,
  onFinish,
}) {
  const steps = useMemo(() => buildSteps(eventsCount), [eventsCount]);
  const total = steps.length;

  const [idx, setIdx]        = useState(0);
  const [spot, setSpot]      = useState(null);  // { x, y, w, h }
  const [tipStyle, setTip]   = useState({});

  const tipRef = useRef(null);
  const step   = run ? steps[idx] : null;

  // ── Spotlight + tooltip positioning ───────────────────────────────────────
  // Depends on currentSection so a section-change render (even if idx didn't
  // change) still triggers a fresh measurement.

  useLayoutEffect(() => {
    if (!step) { setSpot(null); return; }

    if (!step.target) {
      setSpot(null);
      setTip({ top: "50%", left: "50%", transform: "translate(-50%,-50%)" });
      return;
    }

    const el = document.querySelector(step.target);
    if (!el) { setSpot(null); return; }

    const r  = el.getBoundingClientRect();
    const sp = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
    setSpot(sp);

    const th = tipRef.current?.offsetHeight || 260;
    setTip(placeTip(step.placement || "right", sp, th, window.innerWidth, window.innerHeight));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, run, currentSection]);

  // Second layout pass: correct position once tooltip height is actually known.
  useLayoutEffect(() => {
    if (!spot || !tipRef.current || !step?.target) return;
    const th = tipRef.current.offsetHeight;
    setTip(placeTip(step.placement || "right", spot, th, window.innerWidth, window.innerHeight));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleNext() {
    if (idx >= total - 1) { setIdx(0); onFinish(); return; }
    // Navigate first (if needed), then advance — both batched by React 18
    // into one render so the next step's target is already in the DOM.
    if (step?.nav) onNavigate?.(step.nav);
    setIdx(i => i + 1);
  }

  function handleSkip() { setIdx(0); onFinish(); }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!run || !step) return null;

  const isLast  = idx === total - 1;
  const canNext = !step.requireEvent || eventsCount > 0;
  const pct     = Math.round(((idx + 1) / total) * 100);

  // Build overlay divs.
  // Interactive step with spotlight → 4-div frame, hole is clickable.
  // Non-interactive step with spotlight → 4-div frame + transparent blocker over hole.
  // No spotlight → single full-screen div.
  let overlays;
  if (spot) {
    const { x, y, w, h } = spot;
    overlays = [
      { top: 0, left: 0, right: 0, height: Math.max(0, y) },
      { top: y + h, left: 0, right: 0, bottom: 0 },
      { top: y, left: 0, width: Math.max(0, x), height: h },
      { top: y, left: x + w, right: 0, height: h },
    ];
    if (!step.interactive) {
      // Transparent click-blocker sits over the hole so the element is
      // visible but receives no pointer events.
      overlays.push({ top: y, left: x, width: w, height: h, bg: "transparent" });
    }
  } else {
    overlays = [{ top: 0, left: 0, right: 0, bottom: 0 }];
  }

  return (
    <>
      <style>{`
        @keyframes _tour_ring {
          0%,100%{ box-shadow:0 0 0 3px rgba(37,99,235,.8),0 0 0 7px rgba(37,99,235,.15); }
          50%    { box-shadow:0 0 0 4px rgba(37,99,235,1),0 0 0 10px rgba(37,99,235,.06); }
        }
      `}</style>

      <div style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "none" }}>

        {/* ── Overlay divs ── */}
        {overlays.map(({ bg, ...s }, i) => (
          <div key={i} style={{
            position: "fixed",
            background: bg ?? "rgba(0,0,0,0.48)",
            pointerEvents: "all",
            ...s,
          }} />
        ))}

        {/* ── Spotlight ring ── */}
        {spot && (
          <div style={{
            position: "fixed",
            left: spot.x, top: spot.y, width: spot.w, height: spot.h,
            borderRadius: 10,
            animation: "_tour_ring 2s ease-in-out infinite",
            transition: "left .18s,top .18s,width .18s,height .18s",
            pointerEvents: "none",
            zIndex: 10001,
          }} />
        )}

        {/* ── Tooltip ── */}
        <div
          ref={tipRef}
          style={{
            position: "fixed",
            width: TOOLTIP_W,
            background: "#fff",
            borderRadius: 14,
            boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
            padding: "20px 24px",
            pointerEvents: "all",
            zIndex: 10002,
            ...tipStyle,
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500, letterSpacing: ".02em" }}>
              {idx + 1} of {total}
            </span>
            <button
              onClick={handleSkip}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#9ca3af", fontSize: 11, padding: "2px 6px", borderRadius: 4,
              }}
            >
              Skip tour
            </button>
          </div>

          {/* Progress bar */}
          <div style={{ height: 3, background: "#f1f5f9", borderRadius: 2, marginBottom: 14 }}>
            <div style={{
              height: "100%", width: `${pct}%`,
              background: "#2563eb", borderRadius: 2,
              transition: "width .3s ease",
            }} />
          </div>

          {/* Title */}
          <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700, color: "#111827" }}>
            {step.title}
          </h3>

          {/* Body */}
          {step.content}

          {/* Footer */}
          <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
            {!canNext && (
              <span style={{ fontSize: 11.5, color: "#94a3b8" }}>
                Create an event to continue
              </span>
            )}
            <button
              onClick={handleNext}
              disabled={!canNext}
              style={{
                background: canNext ? "#2563eb" : "#cbd5e1",
                color: "#fff", border: "none", borderRadius: 8,
                padding: "9px 20px", fontSize: 13, fontWeight: 600,
                cursor: canNext ? "pointer" : "not-allowed",
                boxShadow: canNext ? "0 2px 8px rgba(37,99,235,.3)" : "none",
                transition: "background .2s,box-shadow .2s",
              }}
            >
              {isLast ? "Finish" : "Next →"}
            </button>
          </div>
        </div>

      </div>
    </>
  );
}
