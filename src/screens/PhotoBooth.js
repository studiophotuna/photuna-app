
// src/screens/PhotoBooth/PhotoBooth.js
import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence } from "framer-motion";

// Screens
import WelcomeScreen from "../PhotoBooth/WelcomeScreen";
import ConsentScreen from "../PhotoBooth/ConsentScreen";
import TemplateScreen from "../PhotoBooth/TemplateScreen";
import PaymentScreen from "../PhotoBooth/PaymentScreen";
import PhotoScreen from "../PhotoBooth/PhotoScreen";
import TemplateSelectionScreen from "../PhotoBooth/TemplateSelectionScreen";
import SelectRetakeScreen from "../PhotoBooth/SelectRetakeScreen";
import FrameFilterScreen from "../PhotoBooth/FrameFilterScreen";
import PrintPreviewScreen from "../PhotoBooth/PrintPreviewScreen";
import StorageChoiceScreen from "../PhotoBooth/StorageChoiceScreen";
import ThankYouScreen from "../PhotoBooth/ThankYouScreen";
import { useLicense } from "../context/LicenseContext";
import { DEFAULT_TEMPLATES } from "../data/defaultTemplates";
import { supabase } from "../services/supabase";

/** Local defaults matching AdminDashboard */
const DEFAULT_SCREEN_TIMERS = {
  template: 10,
  payment: 20,
  retake: 8,
  photoselect: 15,
  framefilter: 12,
  printing: 30,
  thankyou: 6,
};

function RentalStatusBar({ timerEnabled, timerHours, startTime, expired, limitEnabled, sessionCount, sessionLimit, limitReached }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    if (!timerEnabled) return;
    const update = () => {
      const ms = timerHours * 60 * 60 * 1000 - (Date.now() - startTime);
      if (ms <= 0) { setRemaining("0:00:00"); return; }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setRemaining(`${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [timerEnabled, timerHours, startTime]);

  return (
    <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-center gap-6 bg-black/60 backdrop-blur-sm px-4 py-1.5 text-[11px] font-mono text-white/70">
      {timerEnabled && (
        <span className={expired ? "text-red-400 font-bold" : ""}>
          {expired ? "TIME EXPIRED" : `Time left: ${remaining}`}
        </span>
      )}
      {limitEnabled && (
        <span className={limitReached ? "text-red-400 font-bold" : ""}>
          {limitReached ? `SESSION LIMIT REACHED (${sessionCount}/${sessionLimit})` : `Sessions: ${sessionCount} / ${sessionLimit}`}
        </span>
      )}
    </div>
  );
}

export default function PhotoBooth({ frames = [], onShortcut, initialEvent = null, onExit }) {
  const { gating } = useLicense();
  const [screen, setScreen] = useState("WELCOME");
  const [session, setSession] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [selectedFrame, setSelectedFrame] = useState(frames[0] ?? null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [events, setEvents] = useState([]);
  const [activeEventId, setActiveEventId] = useState(initialEvent?.id ?? "default");
  const [eventConfig, setEventConfig] = useState(initialEvent?.config ?? {}); // kept for backward compat wherever you still consume it
  const [retakeIndex, setRetakeIndex] = useState(null);
  const [retakeLimit, setRetakeLimit] = useState(2);
  const [retakenIndices, setRetakenIndices] = useState([]);
  const [templateSelection, setTemplateSelection] = useState(null);
  const selectedEvent =
    initialEvent ?? (events.find((e) => e.id === activeEventId) ?? null);

  const [composedImage, setComposedImage] = useState(null);
  const [composedImagePath, setComposedImagePath] = useState(null);
  const [composedImageUrl, setComposedImageUrl] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [qrImage, setQrImage] = useState(null);
  const [galleryQrUrl, setGalleryQrUrl] = useState(null);
  const [slotVideoMap, setSlotVideoMap] = useState([]);
  const cameraStreamRef = useRef(null);
  const [composedLayout, setComposedLayout] = useState(null);
  const [composedPrintMode, setComposedPrintMode] = useState("single");
  const [composedLayoutConfig, setComposedLayoutConfig] = useState(null);
  const [motionBackgroundColor, setMotionBackgroundColor] = useState("#ffffff");
  const [frameOverlayDataUrl, setFrameOverlayDataUrl] = useState(null);
  const [composedTone, setComposedTone] = useState("normal");
  const sessionRecordedRef = useRef(false);
  const sessionStartTimeRef = useRef(null);
  const [sessionPricing, setSessionPricing] = useState(null);
  const [sessionPayment, setSessionPayment] = useState(null);
  const [sessionQuantity, setSessionQuantity] = useState(1);
  const [sessionTone, setSessionTone] = useState(null);
  const [sessionFrameStyle, setSessionFrameStyle] = useState(null);
  const [galleryUploadMode, setGalleryUploadMode] = useState("system");
  const [cloudStorage, setCloudStorage] = useState({ googleDrive: { connected: false }, dropbox: { connected: false } });

  // Load cloud storage connection status on mount
  useEffect(() => {
    const api = window.api || window.electron;
    if (!api) return;
    Promise.all([
      api.cloudGoogleDrive?.status?.().catch(() => ({ connected: false })),
      api.cloudDropbox?.status?.().catch(() => ({ connected: false })),
    ]).then(([gd, db]) => {
      setCloudStorage({ googleDrive: gd || { connected: false }, dropbox: db || { connected: false } });
    });
  }, []);

  // ---- Idle dimming ----
  const [idleDimmed, setIdleDimmed] = useState(false);
  const [dimEnabled, setDimEnabled] = useState(true);
  const [dimTimeout, setDimTimeout] = useState(60);
  const idleTimerRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await window.electron?.invoke?.("store:getSettings", {});
        if (s) {
          setDimEnabled(s.dimWhenIdle ?? true);
          setDimTimeout(s.idleTimeout ?? 60);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!dimEnabled || (screen !== "WELCOME" && screen !== "CONSENT")) {
      clearTimeout(idleTimerRef.current);
      setIdleDimmed(false);
      return;
    }

    const resetTimer = () => {
      setIdleDimmed(false);
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => setIdleDimmed(true), dimTimeout * 1000);
    };

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "pointerdown"];
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(idleTimerRef.current);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [dimEnabled, dimTimeout, screen]);

  // ---- Rental timer ----
  const rentalSettings = initialEvent?.settings?.rental ?? {};
  const rentalTimerEnabled = !!rentalSettings.timerEnabled;
  const rentalTimerHours = Number(rentalSettings.timerHours) || 2;
  const [rentalExpired, setRentalExpired] = useState(false);
  const rentalStartRef = useRef(Date.now());

  useEffect(() => {
    if (!rentalTimerEnabled) return;
    const ms = rentalTimerHours * 60 * 60 * 1000;
    const remaining = ms - (Date.now() - rentalStartRef.current);
    if (remaining <= 0) { setRentalExpired(true); return; }
    const timer = setTimeout(() => setRentalExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [rentalTimerEnabled, rentalTimerHours]);

  // ---- Session usage limit ----
  const sessionLimitEnabled = !!rentalSettings.sessionLimitEnabled;
  const sessionLimitMax = Number(rentalSettings.sessionLimit) || 100;
  const [sessionCount, setSessionCount] = useState(0);
  const sessionLimitReached = sessionLimitEnabled && sessionCount >= sessionLimitMax;

  const boothLocked = rentalExpired || sessionLimitReached;
  const offlineMode = !!rentalSettings.offlineModeEnabled;
  const autoSaveTarget = rentalSettings.autoSaveTarget ?? "local";
  const endSessionSummaryEnabled = !!rentalSettings.endSessionSummaryEnabled;

  async function dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    return await response.blob();
  }

  async function imagePathToBlob(imagePath) {
    const response = await fetch(imagePath);
    return await response.blob();
  }

  async function sourceToBlob(src) {
    const response = await fetch(src);
    return await response.blob();
  }

  /** NEW: global appearance for PaymentScreen theming */
  const [appearance, setAppearance] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        if (window.api?.getAppearance) {
          const a = await window.api.getAppearance();
          setAppearance(a || null);
        }
      } catch (e) {
        console.warn('[PhotoBooth] failed to load appearance:', e?.message);
      }
    })();
  }, []);

  /** Helper: derive effective settings and timers from current event */
  const deriveSettings = (ev) => {
    const s = ev?.settings ?? {};
    const timers = s.screenTimers ?? DEFAULT_SCREEN_TIMERS;
    return {
      appMode: s.appMode ?? "business",
      business: s.business ?? {},
      countdown: s.countdown ?? 3,
      numberOfShots: s.numberOfShots ?? 6,
      timers: {
        template: timers.template ?? DEFAULT_SCREEN_TIMERS.template,
        payment: timers.payment ?? DEFAULT_SCREEN_TIMERS.payment,
        retake: timers.retake ?? DEFAULT_SCREEN_TIMERS.retake,
        photoselect: timers.photoselect ?? DEFAULT_SCREEN_TIMERS.photoselect,
        framefilter: timers.framefilter ?? DEFAULT_SCREEN_TIMERS.framefilter,
        printing: timers.printing ?? DEFAULT_SCREEN_TIMERS.printing,
        thankyou: timers.thankyou ?? DEFAULT_SCREEN_TIMERS.thankyou,
      },
    };
  };

  /** Helper: should we do a Payment step? */
  const wantsPayment = (ev) => {
    const cfg = deriveSettings(ev);
    const appMode = cfg.appMode;
    const business = cfg.business || {};
    const enabled = !!business.paymentEnabled;
    const providers = business.payment?.providers || {};
    const anyProvider =
      !!providers.cash || !!providers.gcash || !!providers.maya || !!providers.grabpay || !!providers.card || !!providers.stripe;

    // Only do payment in Business mode, with payment enabled AND at least one provider toggled on
    return appMode === "business" && enabled && anyProvider;
  };

  // ---- Preview session bootstrap (server + session) ----
  async function ensurePreviewSession(templateForLayout = null) {
    if (session?.sessionId) return session;
    try {
      // Start the tiny Express preview server in main (no-op if already running)
      await window.api.previewStartServer?.();
      // Prepare a layout object from the selected template if you have one
      const layout = templateForLayout?.previewMeta?.layout
        || { width: 1200, height: 800, slots: [] };
      // Create a unique session folder + token + preview URL
      const sess = await window.api.previewCreateSession?.({ layout });
      if (sess && sess.sessionId) setSession(sess);
      return sess;
    } catch (e) {
      console.error('ensurePreviewSession failed', e);
      setSession(null);
      return null;
    }
  }

  // Unified Template Loader
  const loadFullTemplate = async (tplOrId) => {
    try {
      const id = typeof tplOrId === "string" ? tplOrId : tplOrId?.id;
      if (!id) return null;

      // 1) Look up in the user's template library
      const all = await window.api.getTemplates();
      const found = all.find((t) => String(t.id) === String(id));
      const slots = Array.isArray(found?.previewMeta?.slots) && found.previewMeta.slots.length > 0
        ? found.previewMeta.slots
        : null;

      if (found && slots) {
        return { ...found, previewMeta: { ...found.previewMeta, slots } };
      }

      // 2) Fall back to the DEFAULT_TEMPLATES bundle (covers default-* IDs)
      const defaultTpl = DEFAULT_TEMPLATES.find((t) => String(t.id) === String(id));
      if (defaultTpl) return defaultTpl;

      // 3) Fall back to whatever previewMeta the caller already has on the object
      if (found) {
        return { ...found, previewMeta: { ...found.previewMeta, slots: slots ?? [] } };
      }

      // 4) Last resort: caller passed a full template object — use it directly
      const passedObj = typeof tplOrId === "object" ? tplOrId : null;
      if (passedObj) {
        const passedSlots = Array.isArray(passedObj.previewMeta?.slots)
          ? passedObj.previewMeta.slots
          : Array.isArray(passedObj.slots) ? passedObj.slots : [];
        return { ...passedObj, previewMeta: { ...passedObj.previewMeta, slots: passedSlots } };
      }

      return null;
    } catch (err) {
      console.error("loadFullTemplate failed", err);
      return null;
    }
  };

  // Load events on mount
  useEffect(() => {
    let mounted = true;
    const loadEvents = async () => {
      try {
        if (initialEvent) {
          setEvents((prev) => {
            const found = prev.find((e) => e.id === initialEvent.id);
            if (found) return prev;
            return [initialEvent, ...prev];
          });
          setActiveEventId(initialEvent.id);
          setEventConfig(initialEvent.config ?? {});
          return;
        }
        if (window.api?.getEvents) {
          const allEvents = await window.api.getEvents();
          if (!mounted) return;
          setEvents(allEvents || []);
          if (Array.isArray(allEvents) && allEvents.length > 0) {
            const firstEvent = allEvents[0];
            setActiveEventId(firstEvent.id);
            const config = await (window.api.getEventData ? window.api.getEventData(firstEvent.id) : null);
            setEventConfig(config || {});
          }
        }
      } catch (err) {
        console.error("Failed to load events:", err);
      }
    };
    loadEvents();
    return () => { mounted = false; };
  }, [initialEvent]);

  // Sync retakeLimit from the current event settings
  useEffect(() => {
    // Prefer event's configured limit; default to 0 if missing
    const configured = Number(selectedEvent?.settings?.retakeLimit);
    setRetakeLimit(Number.isFinite(configured) ? configured : 0);
  }, [selectedEvent]);

  // Append a session record to event.sessions[] so dashboard reports are accurate.
  // completed=true when the full flow finishes; false when abandoned mid-flow.
  const recordSession = async (completed = true) => {
    if (sessionRecordedRef.current) return;
    sessionRecordedRef.current = true;
    if (completed) setSessionCount((c) => c + 1);
    try {
      const evId = selectedEvent?.id ?? activeEventId;
      if (!evId || !window.api?.getEvents || !window.api?.setEvents) return;

      const appMode = selectedEvent?.settings?.appMode ?? sessionPricing?.appMode ?? "rental";
      const durationSec = sessionStartTimeRef.current
        ? Math.round((Date.now() - sessionStartTimeRef.current) / 1000)
        : null;

      const base = {
        id: String(Date.now()),
        createdAt: new Date().toISOString(),
        appMode,
        completed,
        photosCount: photos.length,
        template: selectedTemplate?.name ?? selectedTemplate?.id ?? null,
        layout: composedLayout ?? null,
        tone: sessionTone ?? null,
        frameStyle: sessionFrameStyle ?? null,
        retakes: retakenIndices.length,
        durationSec,
        offlineMode,
      };

      // Business sessions include full revenue analytics; rental sessions do not.
      const sessionRecord = appMode === "business" && sessionPricing
        ? {
            ...base,
            revenue: {
              currency: sessionPricing.currency ?? "PHP",
              pricingModel: sessionPricing.pricingModel ?? "perSession",
              baseAmount: sessionPricing.baseAmount ?? 0,
              additionalPrints: sessionPricing.additionalPrints ?? 0,
              additionalFee: sessionPricing.additionalFee ?? 0,
              taxEnabled: sessionPricing.taxEnabled ?? false,
              taxRate: sessionPricing.taxRate ?? 0,
              taxAmount: sessionPricing.taxAmount ?? 0,
              totalAmount: sessionPricing.totalAmount ?? sessionPricing.baseAmount ?? 0,
              paymentProvider: sessionPayment?.method ?? null,
            },
            printQuantity: sessionQuantity ?? 1,
          }
        : base;

      const all = await window.api.getEvents();
      if (!Array.isArray(all)) return;
      const updated = all.map((e) =>
        String(e.id) === String(evId)
          ? { ...e, sessions: [...(e.sessions ?? []), sessionRecord] }
          : e
      );
      await window.api.setEvents(updated);
    } catch (err) {
      console.warn('[PhotoBooth] recordSession failed:', err?.message);
    }
  };

  // Restart session and clear persisted retakenIndices for active event
  const restartSession = async () => {
    // If photos were taken but the session was never recorded (user abandoned), record it now
    if (!sessionRecordedRef.current && photos.length > 0) {
      await recordSession(false);
    }

    sessionRecordedRef.current = false;
    sessionStartTimeRef.current = null;
    setSessionPricing(null);
    setSessionPayment(null);
    setSessionQuantity(1);
    setSessionTone(null);
    setSessionFrameStyle(null);
    setPhotos([]);
    setSession(null);
    {
      const configured = Number(selectedEvent?.settings?.retakeLimit);
      setRetakeLimit(Number.isFinite(configured) ? configured : 0);
    }
    setRetakenIndices([]);
    setRetakeIndex(null);
    setSelectedFrame(frames[0] || null);
    setSelectedTemplate(null);
    setTemplateSelection(null);
    setComposedImage(null);
    setQrImage(null);
    setGalleryQrUrl(null);
    setScreen("WELCOME");

    try {
      const evId = selectedEvent?.id ?? activeEventId;
      if (!evId) return;
      if (window.api?.getEvents && window.api?.setEvents) {
        const all = await window.api.getEvents();
        if (!Array.isArray(all)) return;
        const updated = (all || []).map((e) => {
          if (String(e.id) === String(evId)) {
            e.retakenIndices = [];
          }
          return e;
        });
        await window.api.setEvents(updated);
        return;
      }
      if (window.electron?.getEvents && window.electron?.setEvents) {
        const all = await window.electron.getEvents();
        if (!Array.isArray(all)) return;
        const updated = (all || []).map((e) => {
          if (String(e.id) === String(evId)) {
            e.retakenIndices = [];
          }
          return e;
        });
        await window.electron.setEvents(updated);
      }
    } catch (err) {
      console.warn("Failed to clear persisted retakenIndices on restart:", err);
    }
  };

  // Keyboard shortcut
  useEffect(() => {
    const listener = (e) => {
      if (e.ctrlKey && e.key === "a") {
        onShortcut?.();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onShortcut]);

  // Helper to normalize saved photo objects to src strings
  const normalizeSavedToSrc = (saved) => {
    if (!saved) return null;
    if (typeof saved === "string") return saved;
    if (typeof saved === "object") {
      if (saved.appUrl) return saved.appUrl;
      if (saved.fileUrl) return saved.fileUrl;
      if (saved.filePath) return `file://${saved.filePath}`;
      if (saved.dataUrl) return saved.dataUrl;
    }
    return null;
  };

  // ===== Derived, per-event, per-screen values =====
  const effective = deriveSettings(selectedEvent);
  const paymentTimer = effective.timers.payment;
  const photoCountdown = effective.countdown;         // replaces hard-coded 3
  const photoShots = Math.max(                        // ensure enough shots for template slots
    effective.numberOfShots,
    selectedTemplate?.previewMeta?.slots?.length ?? 0
  );
  const selectTimer = effective.timers.photoselect;   // replaces 40
  const filterTimer = effective.timers.framefilter;   // replaces 45
  const printingTimer = effective.timers.printing;    // replaces 30
  const thankyouTimer = effective.timers.thankyou;    // replaces 10

  return (
    <div className="w-full h-screen bg-black text-white overflow-hidden relative">
      {/* Rental status bar — visible to operator */}
      {(rentalTimerEnabled || sessionLimitEnabled) && (
        <RentalStatusBar
          timerEnabled={rentalTimerEnabled}
          timerHours={rentalTimerHours}
          startTime={rentalStartRef.current}
          expired={rentalExpired}
          limitEnabled={sessionLimitEnabled}
          sessionCount={sessionCount}
          sessionLimit={sessionLimitMax}
          limitReached={sessionLimitReached}
        />
      )}
      {idleDimmed && (
        <div
          className="absolute inset-0 z-50 bg-black/80 transition-opacity duration-700 flex items-center justify-center cursor-pointer"
          onPointerDown={() => setIdleDimmed(false)}
        >
          <p className="text-white/40 text-lg font-medium animate-pulse">Tap to start</p>
        </div>
      )}
      <AnimatePresence mode="wait">
        {screen === "WELCOME" && (
          <>
            <WelcomeScreen
              key="welcome"
              event={selectedEvent}
              eventConfig={eventConfig}
              onNext={boothLocked ? undefined : () => {
                const skipConsent = selectedEvent?.settings?.consentEnabled === false;
                setScreen(skipConsent ? "TEMPLATE" : "CONSENT");
              }}
            />
            {boothLocked && (
              <div className="absolute inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center">
                <div className="max-w-md text-center px-8 py-10 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md">
                  <svg className="w-14 h-14 mx-auto text-amber-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <h2 className="text-2xl font-bold text-white">
                    {rentalExpired ? "Session Time Expired" : "Session Limit Reached"}
                  </h2>
                  <p className="mt-3 text-base text-white/70">
                    {rentalExpired
                      ? "The rental period for this booth has ended."
                      : `All ${sessionLimitMax} sessions have been used.`}
                  </p>
                  <p className="mt-4 text-lg font-semibold text-amber-300 animate-pulse">
                    Please call the operator for assistance.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {screen === "CONSENT" && (
          <ConsentScreen
            key="consent"
            event={selectedEvent}
            eventConfig={eventConfig}
            galleryAvailable={Boolean(
              (gating?.galleryEnabled || gating?.galleryAddon) &&
              !selectedEvent?.settings?.galleryOptionDisabled
            )}
            onDecline={() => setScreen("WELCOME")}
            onAccept={({ consentVersion, consentedAt }) => {
              // Fire-and-forget: don't await — renderer-side Supabase fetch can
              // hang on file:// origins in Electron, blocking the screen transition.
              const pendingSessionId = `pre-${Date.now()}`;
              (async () => {
                try {
                  await supabase.from("booth_consent_logs").insert({
                    session_id: pendingSessionId,
                    event_id: selectedEvent?.id || "unknown",
                    booth_id: selectedEvent?.boothId || null,
                    consent_version: consentVersion,
                    consented_at: consentedAt,
                  });
                } catch {}
              })();
              setScreen("TEMPLATE");
            }}
          />
        )}

        {screen === "TEMPLATE" && (
          <TemplateScreen
            key="template"
            event={selectedEvent}
            eventConfig={eventConfig}
            frames={frames}
            selectedFrame={selectedFrame}
            cameraStreamRef={cameraStreamRef}
            onSelectFrame={setSelectedFrame}
            onCancel={() => setScreen("WELCOME")}
            onNext={async () => {
              // Create preview session before entering PHOTO
              await ensurePreviewSession(selectedTemplate);
              sessionStartTimeRef.current = Date.now();
              wantsPayment(selectedEvent) ? setScreen("PAYMENT") : setScreen("PHOTO");
            }}
            onSelect={async (tpl) => {
              const fullTpl = await loadFullTemplate(tpl);
              setSelectedTemplate(fullTpl);

              // Create preview session (with template layout) before PHOTO
              await ensurePreviewSession(fullTpl);
              wantsPayment(selectedEvent) ? setScreen("PAYMENT") : setScreen("PHOTO");

            }}
            onApplyTemplate={(tpl) => {
              try {
                const evId = activeEventId;
                if (evId && window.api?.getEvents) {
                  window.api
                    .getEvents()
                    .then((all) => {
                      const updated = (all || []).map((e) => {
                        if (e.id === evId) {
                          e.appliedTemplates = e.appliedTemplates || [];
                          if (!e.appliedTemplates.find((at) => at.id === tpl.id))
                            e.appliedTemplates.push(tpl);
                        }
                        return e;
                      });
                      window.api.setEvents?.(updated);
                    })
                    .catch((e) => console.warn('[PhotoBooth] setEvents failed:', e?.message));
                }
              } catch (err) {
                console.warn(err);
              }
            }}
          />
        )}

        {screen === "PAYMENT" && (
          <PaymentScreen
            key="payment"
            event={selectedEvent}
            appearance={appearance}

            onNext={async () => {
              await ensurePreviewSession(selectedTemplate);
              sessionStartTimeRef.current = Date.now();
              setScreen("PHOTO");
            }}

            onCancel={() => setScreen("WELCOME")}
            onBack={() => setScreen("TEMPLATE")}
            // amountDue is only a fallback; PaymentScreen computes total from event.settings.business
            amountDue={selectedEvent?.settings?.price ?? 150}
          />
        )}

        {screen === "PHOTO" && (
          <PhotoScreen
            key="photo"
            session={session}
            frame={selectedFrame}
            event={selectedEvent}
            eventConfig={eventConfig}
            eventId={selectedEvent?.id ?? activeEventId}
            mirrorCamera={selectedEvent?.settings?.mirrorCamera}
            cameraStreamRef={cameraStreamRef}
            templateSelection={selectedTemplate}
            onCapture={(saved) => {
              const src = normalizeSavedToSrc(saved);
              setPhotos((prev) => [...prev, src ?? saved]);
            }}
            onFinish={(allPhotos) => {
              const normalized = (allPhotos || []).map((p) => normalizeSavedToSrc(p) ?? p);
              setPhotos(normalized);
              if ((retakeLimit ?? 0) <= 0) {
                setScreen("TEMPLATE_SELECT");
              } else {
                setScreen("RETAKE");
              }
            }}
            countdownSeconds={photoCountdown}
            numberOfShots={photoShots}
            onCancel={restartSession}
          />
        )}

        {screen === "RETAKE" && (retakeLimit ?? 0) > 0 && (
          <SelectRetakeScreen
            photos={photos}
            frame={selectedFrame}
            event={selectedEvent}
            eventId={selectedEvent?.id ?? activeEventId}
            retakeLimit={retakeLimit}
            retakenIndices={retakenIndices}
            onRetake={(indices) => {
              if (!Array.isArray(indices) || indices.length === 0) return;
              if (retakeLimit >= indices.length) {
                setRetakeIndex(indices);
                setScreen("PHOTO_RETAKE");
              }
            }}
            onConfirm={(updatedPhotos) => {
              if (Array.isArray(updatedPhotos) && updatedPhotos.length > 0) {
                setPhotos(updatedPhotos.map((p) => normalizeSavedToSrc(p) ?? p));
              }
              setScreen("TEMPLATE_SELECT");
            }}
            onBack={() => setScreen("TEMPLATE_SELECT")}
          />
        )}

        {screen === "PHOTO_RETAKE" && Array.isArray(retakeIndex) && retakeIndex.length > 0 && (
          <PhotoScreen
            key="photo_retake"
            session={session}
            event={selectedEvent}
            frame={selectedFrame}
            eventId={selectedEvent?.id ?? activeEventId}
            mirrorCamera={selectedEvent?.settings?.mirrorCamera}
            cameraStreamRef={cameraStreamRef}
            templateSelection={selectedTemplate}
            retakeIndices={retakeIndex}
            countdownSeconds={photoCountdown}
            onFinish={(results) => {
              // results expected: [{ index, saved }, ...]
              setPhotos((prev) => {
                const updated = [...prev];
                (results || []).forEach((r) => {
                  const src = normalizeSavedToSrc(r?.saved) ?? r?.saved?.dataUrl ?? null;
                  if (typeof r.index === "number") updated[r.index] = src ?? updated[r.index];
                });
                return updated;
              });
              setRetakenIndices((prev) => Array.from(new Set([...(prev || []), ...retakeIndex])));

              setRetakeLimit((prev) => {
                const next = prev - retakeIndex.length;
                // After consuming remaining retakes, decide where to go
                if (next <= 0) {
                  setRetakeIndex(null);
                  setScreen("TEMPLATE_SELECT");
                } else {
                  setRetakeIndex(null);
                  setScreen("RETAKE");
                }
                return next;
              });

            }}
          />
        )}

        {screen === "TEMPLATE_SELECT" && (
          <TemplateSelectionScreen
            eventId={activeEventId}
            event={selectedEvent}
            photos={photos.map((p) => {
              if (!p) return null;
              if (typeof p === "string") return p;
              if (typeof p === "object")
                return p.fileUrl ?? (p.filePath ? `file://${p.filePath}` : p.dataUrl) ?? null;
              return null;
            })}
            numberOfShots={photoShots}
            countdownStart={selectTimer}
            frame={selectedEvent?.appliedFrame ?? selectedEvent?.frame ?? selectedFrame}
            template={selectedTemplate ?? null}
            onBack={() => setScreen("FRAME_FILTER")}
            onNext={async (payload) => {
              const fullTpl = await loadFullTemplate(payload.templateId);

              // Normalize template slot definition
              const templateSlots = Array.isArray(fullTpl?.slots)
                ? fullTpl.slots
                : Array.isArray(fullTpl?.previewMeta?.slots)
                  ? fullTpl.previewMeta.slots
                  : typeof fullTpl?.slots === "object"
                    ? Object.values(fullTpl.slots)
                    : [];

              if (!templateSlots.length) {
                console.error("NO SLOT DEFINITIONS FOUND IN TEMPLATE:", fullTpl);
                alert("This template does not contain slot definitions.");
                return;
              }

              // Build a lookup by slotId from payload
              const userById = new Map((payload.slots || []).map((s) => [String(s.slotId), s]));

              const mergedSlots = templateSlots.map((slotDef, i) => {
                const defId = String(slotDef.slotId || slotDef.id || i);
                const user = userById.get(defId) || payload.slots?.[i] || {};

                return {
                  // Keep BOTH id and slotId for compatibility with different screens
                  id: slotDef.id ?? defId,
                  slotId: defId,

                  // Layout fields (MUST include rotation)
                  x: slotDef.x ?? 0,
                  y: slotDef.y ?? 0,
                  w: slotDef.w ?? 0.25,
                  h: slotDef.h ?? 0.25,
                  rotation: slotDef.rotation ?? 0,
                  slotNumber: slotDef.slotNumber ?? i + 1,

                  // Selection fields
                  photoIndex: user.photoIndex ?? null,
                  photoUrl: user.photoUrl ?? null,   // ✅ carry the absolute URL forward
                  transform: user.transform ?? { scale: 1, offsetX: 0, offsetY: 0 },
                };
              });

              setTemplateSelection({
                templateId: payload.templateId,
                layout: payload.layout,                // keep for compatibility
                slots: mergedSlots,
                // ✅ include what Frame Filter needs
                previewMeta: {
                  ...(fullTpl?.previewMeta ?? {}),
                },
              });

              setScreen("FRAME_FILTER");
            }}
          />
        )}

        {screen === "FRAME_FILTER" && (
          <FrameFilterScreen
            key="framefilter"
            eventId={activeEventId}
            event={selectedEvent}
            sessionId={session?.sessionId || activeSessionId || "default"}
            countdownStart={filterTimer}
            templateSelection={templateSelection}
            watermark={Boolean(gating?.watermark)}
            galleryEnabled={Boolean(gating?.galleryEnabled || gating?.galleryAddon)}
            photos={photos.map((p) => {
              if (!p) return null;
              if (typeof p === "string") return p;
              if (typeof p === "object") {
                return p.fileUrl ?? (p.filePath ? `file://${p.filePath}` : p.dataUrl) ?? null;
              }
              return null;
            })}
            onNext={async (payload) => {
              if (payload?.composedImage) setComposedImage(payload.composedImage);
              if (payload?.composedImagePath) setComposedImagePath(payload.composedImagePath);
              if (payload?.composedImageUrl) setComposedImageUrl(payload.composedImageUrl);
              if (payload?.sessionId) setActiveSessionId(payload.sessionId);
              if (payload?.qrImage) setQrImage(payload.qrImage);

              if (payload?.layout) setComposedLayout(payload.layout);
              if (payload?.printMode) setComposedPrintMode(payload.printMode);
              if (payload?.layoutConfig) setComposedLayoutConfig(payload.layoutConfig);
              if (Array.isArray(payload?.slotVideoMap)) setSlotVideoMap(payload.slotVideoMap);

              if (payload?.motionBackgroundColor) {
                setMotionBackgroundColor(payload.motionBackgroundColor);
              }
              setFrameOverlayDataUrl(payload?.frameOverlayDataUrl || null);
              if (payload?.tone) setComposedTone(payload.tone);

              // Capture pricing/payment data for session analytics
              if (payload?.pricing) setSessionPricing(payload.pricing);
              if (payload?.payment) setSessionPayment(payload.payment);
              if (payload?.quantity) setSessionQuantity(payload.quantity ?? 1);
              if (payload?.selectedToneEffectId) setSessionTone(payload.selectedToneEffectId);
              if (payload?.selectedFrameStyleId) setSessionFrameStyle(payload.selectedFrameStyleId);

              setGalleryQrUrl(null);
              setGalleryUploadMode("system");
              const skipStorageChoice = selectedEvent?.settings?.storageChoiceEnabled !== true;
              setScreen(skipStorageChoice ? "PRINT" : "STORAGE_CHOICE");
            }}
            onCancel={() => setScreen("TEMPLATE_SELECT")}
          />
        )}

        {screen === "STORAGE_CHOICE" && (
          <StorageChoiceScreen
            key="storagechoice"
            event={selectedEvent}
            eventConfig={eventConfig}
            operatorStorage={{
              enabled: selectedEvent?.settings?.operatorStorageEnabled,
              label: selectedEvent?.settings?.operatorStorageLabel || "Our Storage",
            }}
            cloudStorage={cloudStorage}
            galleryOptionDisabled={Boolean(selectedEvent?.settings?.galleryOptionDisabled)}
            onSelect={(mode) => {
              setGalleryUploadMode(mode);
              setScreen("PRINT");
            }}
          />
        )}

        {screen === "PRINT" && (
          <PrintPreviewScreen
            seconds={deriveSettings(selectedEvent).timers.printing}
            qrImage={qrImage}
            qrUrl={galleryQrUrl}
            composedImage={composedImage}
            composedImagePath={composedImagePath}
            composedImageUrl={composedImageUrl}
            sessionId={activeSessionId || session?.sessionId || "default"}
            eventId={activeEventId || "default"}
            event={selectedEvent}
            layout={composedLayout}
            printMode={composedPrintMode}
            layoutConfig={composedLayoutConfig}
            photos={photos
              .map((p) => {
                if (!p) return null;
                if (typeof p === "string") return p;
                if (typeof p === "object") {
                  return p.fileUrl ?? (p.filePath ? `file://${p.filePath}` : p.dataUrl) ?? null;
                }
                return null;
              })
              .filter(Boolean)}
            slotVideoMap={slotVideoMap}
            frameOverlayDataUrl={frameOverlayDataUrl}
            motionBackgroundColor={motionBackgroundColor}
            tone={composedTone}
            watermark={Boolean(gating?.watermark)}
            galleryEnabled={!offlineMode && Boolean(gating?.galleryEnabled || gating?.galleryAddon)}
            offlineMode={offlineMode}
            autoSaveTarget={autoSaveTarget}
            uploadMode={galleryUploadMode}
            cloudStorage={cloudStorage}
            eventName={selectedEvent?.appearance?.boothName || selectedEvent?.name || "Event"}
            operatorStorage={{
              webhookUrl: selectedEvent?.settings?.operatorStorageUrl || "",
              apiKey: selectedEvent?.settings?.operatorStorageApiKey || "",
              label: selectedEvent?.settings?.operatorStorageLabel || "Our Storage",
            }}
            onPrintComplete={() => { }}
            onNextPage={() => { recordSession(true); setScreen("THANK_YOU"); }}
          />
        )}

        {screen === "THANK_YOU" && (
          <ThankYouScreen
            eventId={activeEventId}
            event={selectedEvent}
            countdownStart={thankyouTimer}
            onRestart={restartSession}
            sessionSummary={endSessionSummaryEnabled ? {
              photoCount: photos.length,
              sessionNumber: sessionCount,
              offlineMode,
            } : null}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
