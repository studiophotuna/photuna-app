
// src/App.js
import React, { useEffect, useState, useRef, useCallback } from "react";
import AdminDashboard from "./screens/AdminDashboard";
import PhotoBooth from "./screens/PhotoBooth";
import AuthGate from "./components/AuthGate"; // from earlier step
import { useAuth } from "./context/AuthContext";
import { useLicense } from "./context/LicenseContext";
import * as licensingApi from "./services/licensingApi";
import { registerBooth, unregisterBooth } from './services/boothRegistry';
import { sendRemoteAck, subscribeToRemoteCommands } from './services/remoteControl';

const native = () => window.electron || window.api || null;

// ─── Soft announcement banner (dismissible) ──────────────────────────────────
function UpdateBanner({ version, onUpdateNow, onDismiss }) {
  return (
    <div className="fixed top-0 left-0 right-0 z-[9998] flex items-center justify-between gap-3 bg-blue-600 px-4 py-2.5 shadow-lg">
      <div className="flex items-center gap-2.5 min-w-0">
        <svg className="h-4 w-4 flex-shrink-0 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        <span className="text-sm font-medium text-white truncate">
          {version ? `Photuna ${version} is available` : "A new update is available"}
        </span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          type="button"
          onClick={onUpdateNow}
          className="rounded-md bg-white/20 hover:bg-white/30 active:bg-white/40 px-3 py-1 text-xs font-bold text-white transition"
        >
          Update now
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-white/70 hover:text-white transition"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Forced update modal (no dismiss, no "Later") ────────────────────────────
function UpdateModal({ status, version, percent, onInstall }) {
  const isDownloading = status === "downloading";
  const isReady       = status === "downloaded";

  if (!isDownloading && !isReady) return null;

  return (
    // Pointer-events cover the whole screen so the UI behind is unreachable
    <div className="fixed inset-0 z-[9999] flex items-end justify-center sm:items-center p-4 bg-slate-900/60 backdrop-blur-sm pointer-events-auto">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-[0_32px_80px_rgba(0,0,0,0.25)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-700 to-blue-500">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/20">
            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d={isReady ? "M5 13l4 4L19 7" : "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"} />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-white">
              {isReady ? "Update ready to install" : "Downloading required update…"}
            </p>
            {version && <p className="text-[11px] text-white/70">Version {version}</p>}
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {isDownloading && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] font-semibold text-slate-500">
                <span>Downloading…</span>
                <span>{Math.round(percent ?? 0)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${Math.round(percent ?? 0)}%` }}
                />
              </div>
              <p className="text-xs text-slate-400">A required update is downloading. Please do not close the app.</p>
            </div>
          )}

          {isReady && (
            <p className="text-sm text-slate-600">
              The update has finished downloading. Restart now to apply it — the app will reopen automatically.
            </p>
          )}

          {/* Single action — no "Later" */}
          {isReady && (
            <button
              type="button"
              onClick={onInstall}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-500 transition active:scale-[0.98]"
            >
              Restart &amp; Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Free-trial benefits modal ───────────────────────────────────────────────
function TrialBenefitsModal({ onStartTrial, onDismiss, loading }) {
  const BENEFITS = [
    "Full photobooth kiosk experience — capture, select, print",
    "Template & frame editor with 10 built-in layouts",
    "Up to 3 events and 5 templates to test your setup",
    "Custom booth branding — name, logo, fonts, colors",
    "Frame & filter overlays during the booth session",
    "Session analytics and sharing dashboard",
  ];
  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl overflow-hidden bg-white shadow-[0_32px_80px_rgba(0,0,0,0.22)]">
        {/* Header */}
        <div className="bg-gradient-to-br from-blue-700 to-blue-500 px-6 py-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-blue-200 mb-1">Limited-time offer</p>
          <h2 className="text-xl font-extrabold text-white leading-tight">Try Photuna Pro free<br/>for 14 days</h2>
          <p className="mt-1 text-sm text-blue-100">No credit card required. No commitment.</p>
        </div>
        {/* Benefits */}
        <div className="px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">What you get</p>
          <ul className="space-y-2.5">
            {BENEFITS.map((b) => (
              <li key={b} className="flex items-start gap-2.5">
                <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-slate-700 leading-snug">{b}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] text-slate-400 leading-snug">
            Trial prints include a small watermark. Upgrade to Pro any time for clean, unbranded output.
          </p>
        </div>
        {/* Actions */}
        <div className="px-6 pb-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onStartTrial}
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white shadow-md shadow-blue-200 hover:bg-blue-700 active:scale-[0.98] transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Starting trial…" : "Start Free Trial"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="w-full text-center text-sm text-slate-400 hover:text-slate-600 transition py-1"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

function AppLoadingScreen({ message }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-slate-50">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-slate-200 border-t-blue-600" />
      <p className="text-sm font-medium text-slate-500">{message}</p>
    </div>
  );
}

export default function App() {
  const { user, logout, loading: authLoading } = useAuth();
  const unsubRef = useRef(null);
  const boothIdRef = useRef(null);
  const { gating, license, loading: licenseLoading, refreshLicense } = useLicense();
  const [mode, setMode] = useState("admin"); // "admin" | "photobooth"
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [frames, setFrames] = useState([]);
  const [jumpToUpdate, setJumpToUpdate] = useState(false);
  const [jumpToBilling, setJumpToBilling] = useState(false);
  const [showTrialModal, setShowTrialModal] = useState(false);
  const [trialStarting, setTrialStarting] = useState(false);

  // ── Forced update state (no dismiss) ────────────────────────────────────
  const [updateStatus, setUpdateStatus]   = useState("idle");
  const [updateVersion, setUpdateVersion] = useState("");
  const [updatePercent, setUpdatePercent] = useState(0);

  useEffect(() => {
    const api = window.api || window.electron;
    if (!api?.onUpdaterStatus) return;

    const unsub = api.onUpdaterStatus((payload) => {
      const incoming = payload?.status || "idle";

      if (incoming === "available") {
        // Show announcement banner — let the user choose to download.
        setUpdateStatus("available");
        if (payload?.version) setUpdateVersion(payload.version);
        return;
      }

      // "downloaded" is sticky — never revert to a lesser state
      setUpdateStatus((prev) => (prev === "downloaded" && incoming !== "downloaded") ? prev : incoming);
      if (payload?.version) setUpdateVersion(payload.version);
      if (incoming === "downloading") setUpdatePercent(Math.round(payload?.percent ?? 0));
    });

    return unsub;
  }, []);

  const handleUpdateInstall = useCallback(async () => {
    if (updateStatus === "downloaded") {
      await (window.api || window.electron)?.invoke?.("app:install-update");
    }
  }, [updateStatus]);

  // Load frames when the authenticated user ID is available.
  // Using user?.id as the dep (not []) ensures this re-runs after
  // setCurrentUser syncs to the electron store — on first boot the
  // fire-and-forget setCurrentUser IPC races with the initial [] run,
  // causing getFrames to read from users.null.frames (empty).
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const loadedFrames = (await window.api?.getFrames?.()) ?? [];
        setFrames(Array.isArray(loadedFrames) ? loadedFrames : []);
      } catch (err) {
        console.warn("No frames API or failed to load frames", err);
      }
    })();
  }, [user?.id]);

  // Show trial modal once per session for free-plan users who haven't redeemed yet
  useEffect(() => {
    // Wait until both auth and license have fully resolved AND a license object exists.
    // Without the `!license` guard, `trialRedeemed` reads as undefined (falsy) when the
    // license object hasn't arrived yet even though licenseLoading is already false.
    if (licenseLoading || authLoading || !user?.id || !license) return;
    const dismissed = sessionStorage.getItem(`trial_prompt_seen_${user.id}`);
    if (dismissed) return;
    // gating.active is true for both trial and paid plans — covers all non-free states
    if (gating.active) return;
    const isFreePlan = !gating.plan || gating.plan === 'free';
    const trialNotUsed = !license.trialRedeemed && !license.trialExpired;
    if (isFreePlan && trialNotUsed) setShowTrialModal(true);
  }, [licenseLoading, authLoading, user?.id, license, gating.active, gating.plan]);

  useEffect(() => {
    if (!user?.id) return;

    let boothId = null;

    (async () => {
      // Get device fingerprint from Electron
      const fp = await window.system?.getFingerprint?.();
      const fingerprint = fp?.fingerprint ?? null;

      // Pull booth name from saved settings so it matches what the operator set
      let savedBoothName = 'My Booth';
      try {
        const raw = localStorage.getItem('boothSettings');
        const s = raw ? JSON.parse(raw) : {};
        savedBoothName = s.boothIdentityName || s.boothName || 'My Booth';
      } catch {}

      // Register booth in Supabase
      const booth = await registerBooth({
        userId: user.id,
        boothName: savedBoothName,
        fingerprint,
        platform: navigator.platform || navigator.userAgent,
        // Injected from package.json version by the build script. The literal
        // fallback only applies to an unconfigured dev run — never hardcode a
        // release number here, it silently misreports the booth's version.
        appVersion: process.env.REACT_APP_VERSION || 'dev',
      });

      if (!booth) return;
      boothId = booth.id;
      boothIdRef.current = booth.id;

      // Subscribe to remote commands for this booth
      unsubRef.current = subscribeToRemoteCommands(boothId, handleRemoteCommand);

      // Restore kiosk mode if the booth was running an event before a crash/reboot.
      // Gated on a one-shot main-process flag so this only fires on a genuine
      // app restart — an operator's Ctrl+R reload must still land on admin.
      try {
        const { shouldResume } = (await native()?.invoke?.('app:should-auto-resume-kiosk')) || {};
        if (shouldResume) {
          const raw = localStorage.getItem('photuna_kiosk_event');
          if (raw) {
            const savedEvent = JSON.parse(raw);
            if (savedEvent?.id) {
              setSelectedEvent(savedEvent);
              setMode("photobooth");
            }
          }
        }
      } catch {}
    })();

    return () => {
      unsubRef.current?.();
      boothIdRef.current = null;
      unregisterBooth();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Called by AdminDashboard when user chooses to start photobooth for an event
  const handleStartPhotobooth = async (eventObj) => {
    if (!eventObj) return;
    if (!gating.allow) {
      alert(
        `Your license is restricted (${gating.reason}). Please redeem the free trial or upgrade to continue.`
      );
      return;
    }

    const hasTemplates = Array.isArray(eventObj.appliedTemplates) && eventObj.appliedTemplates.length > 0;
    if (!hasTemplates) {
      alert("This event has no templates. Please create and apply at least one template before starting the booth.");
      return;
    }

    try {
      const config = (await native()?.getEventData?.(eventObj.id)) ?? {};
      const ev = { ...eventObj, config };
      setSelectedEvent(ev);
      setMode("photobooth");
      try { localStorage.setItem('photuna_kiosk_event', JSON.stringify(ev)); } catch {}
      native()?.invoke?.('app:kiosk-save', { eventId: eventObj.id, eventName: eventObj.name }).catch(() => {});
    } catch (err) {
      console.error("Failed to load event config", err);
      setSelectedEvent(eventObj);
      setMode("photobooth");
      try { localStorage.setItem('photuna_kiosk_event', JSON.stringify(eventObj)); } catch {}
      native()?.invoke?.('app:kiosk-save', { eventId: eventObj.id, eventName: eventObj.name }).catch(() => {});
    }
  };

  const handleExitPhotobooth = (updatedEvent) => {
    setSelectedEvent(null);
    setMode("admin");
    try { localStorage.removeItem('photuna_kiosk_event'); } catch {}
    native()?.invoke?.('app:kiosk-clear').catch(() => {});
  };

  const handleBannerUpdateNow = useCallback(async () => {
    setJumpToUpdate(true);

    // Mark "downloading" BEFORE awaiting. app:download-update resolves only
    // once the download has fully finished, by which point update-downloaded
    // has already set "downloaded" — setting the state after the await
    // overwrote that and stranded the banner at "Downloading 0%" with no way
    // to reach Install (handleUpdateInstall requires status "downloaded").
    // Never downgrade a state that is already "downloaded".
    setUpdateStatus((prev) => (prev === "downloaded" ? prev : "downloading"));
    setUpdatePercent(0);

    // Promise.resolve(...) so a missing invoke short-circuits to undefined
    // instead of throwing on .catch of undefined.
    const result = await Promise.resolve(
      (window.api || window.electron)?.invoke?.("app:download-update")
    ).catch(() => null);

    // Only fall back on an explicit failure; on success the update-downloaded
    // event owns the transition to "downloaded".
    if (result && result.ok === false) {
      setUpdateStatus((prev) => (prev === "downloaded" ? prev : "available"));
    }
  }, []);

  // Block render until auth AND the initial license fetch have resolved.
  // We only gate on the FIRST load — licenseLoading goes true again on every
  // manual refresh (e.g. AdminDashboard calling refreshLicense after billing),
  // so gating on licenseLoading directly creates an infinite unmount/remount loop.
  const licenseEverLoaded = React.useRef(false);
  if (!licenseLoading) licenseEverLoaded.current = true;

  if (authLoading || (user && !licenseEverLoaded.current)) {
    return (
      <AppLoadingScreen
        message={authLoading ? "Restoring your session…" : "Loading your account…"}
      />
    );
  }

  // Not logged in? Show Auth Gate (login/register + trial/upgrade)
  if (!user) {
    return <AuthGate />;
  }

  async function handleRemoteCommand(message = {}) {
    const { action } = message;
    const payload = message.payload || {};

    switch (action) {
      case 'update-template':
        // Apply a new template pushed from admin dashboard
        console.log('Remote: update template', payload.templateId);
        // dispatch to your state or call native?.setTemplates?.(...)
        break;

      case 'update-event':
        // Admin pushed updated event settings
        console.log('Remote: update event', payload.event);
        if (payload.event?.id) {
          const currentEvents = (await window.api?.getEvents?.({ userId: user.id })) || [];
          const exists = currentEvents.some((event) => event.id === payload.event.id);
          const nextEvents = exists
            ? currentEvents.map((event) => event.id === payload.event.id ? payload.event : event)
            : [...currentEvents, payload.event];

          await window.api?.setEvents?.(nextEvents, { userId: user.id });
          await window.api?.setCurrentEventId?.(payload.event.id);
          setSelectedEvent((current) =>
            current?.id === payload.event.id ? payload.event : current
          );
          await sendRemoteAck(boothIdRef.current, action, { ok: true, eventId: payload.event.id });
        }
        break;

      case 'restart-booth':
        await sendRemoteAck(boothIdRef.current, action, { ok: true });
        // Short delay so the ACK is sent before the process exits
        setTimeout(() => native()?.invoke?.('app:restart'), 500);
        break;

      case 'stop-booth':
        try { localStorage.removeItem('photuna_kiosk_event'); } catch {}
        await native()?.invoke?.('app:kiosk-clear').catch(() => {});
        await sendRemoteAck(boothIdRef.current, action, { ok: true });
        setTimeout(() => native()?.invoke?.('app:quit'), 500);
        break;

      case 'lock-booth':
        console.log('Remote: booth locked');
        break;

      case 'ping':
        await sendRemoteAck(boothIdRef.current, action, { ok: true });
        break;

      default:
        console.warn('Unknown remote command:', action);
    }
  }

  return (
    <div className="w-full h-screen">

      {/* Free trial benefits modal — shown once per session for eligible free-plan users */}
      {mode === "admin" && showTrialModal && (
        <TrialBenefitsModal
          loading={trialStarting}
          onDismiss={() => {
            sessionStorage.setItem(`trial_prompt_seen_${user?.id}`, "1");
            setShowTrialModal(false);
          }}
          onStartTrial={async () => {
            setTrialStarting(true);
            try {
              await licensingApi.redeemTrial();
              await refreshLicense();
              sessionStorage.setItem(`trial_prompt_seen_${user?.id}`, "1");
              setShowTrialModal(false);
            } catch (e) {
              console.error("Trial start failed", e);
              // Fall back to billing tab so they can try again
              sessionStorage.setItem(`trial_prompt_seen_${user?.id}`, "1");
              setShowTrialModal(false);
              setJumpToBilling(true);
            } finally {
              setTrialStarting(false);
            }
          }}
        />
      )}

      {/* Soft announcement banner — shown in admin mode when update is available */}
      {mode === "admin" && updateStatus === "available" && (
        <UpdateBanner
          version={updateVersion}
          onUpdateNow={handleBannerUpdateNow}
          onDismiss={() => setUpdateStatus("dismissed")}
        />
      )}

      {/* Forced update modal — takes over during download / install */}
      {mode === "admin" && (
        <UpdateModal
          status={updateStatus}
          version={updateVersion}
          percent={updatePercent}
          onInstall={handleUpdateInstall}
        />
      )}

      {mode === "photobooth" && selectedEvent ? (
        <PhotoBooth
          frames={frames}
          onShortcut={() => { }}
          initialEvent={selectedEvent}
          onExit={(updatedEvent) => {
            handleExitPhotobooth(updatedEvent);
          }}
        />
      ) : (
        <AdminDashboard
          onLogout={() => {
            // logout() is already called inside AdminDashboard's handleLogoutClick.
            // Setting user = null there causes App to re-render <AuthGate /> here.
            // Nothing extra needed.
          }}
          onStartPhotobooth={handleStartPhotobooth}
          jumpToUpdate={jumpToUpdate}
          onJumpToUpdateHandled={() => setJumpToUpdate(false)}
          jumpToBilling={jumpToBilling}
          onJumpToBillingHandled={() => setJumpToBilling(false)}
        />
      )}
    </div>
  );
}
