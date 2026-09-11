// Shown instead of the app when this device was refused a seat because every
// device seat on the account is taken.
//
// The operator is usually standing at the device when this appears, often
// while setting up for an event, so the way out lives on this screen: release a
// device they no longer use, and this one takes its seat straight away. They
// should not need a second computer to recover.
//
// Visual language matches AuthGate (same background, card and Fraunces heading),
// since this is the same moment in the flow — before the dashboard.

import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../services/supabase.js";
import * as licensingApi from "../services/licensingApi";
import { useLicense } from "../context/LicenseContext";
import { useAuth } from "../context/AuthContext";
import { deviceDisplayName, deviceTypeLabel, takesSeat } from "../platform/deviceIdentity";

const PLAN_NAMES = {
  free: "Free",
  trial: "Trial",
  monthly: "Monthly",
  pro_monthly: "Monthly",
  yearly: "Yearly",
  pro_yearly: "Yearly",
};

function ago(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(t)) return "unknown";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export default function DeviceLimitGate() {
  const { deviceLimit, gating, refreshLicense } = useLicense();
  const { logout } = useAuth();

  const [devices, setDevices] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [releasing, setReleasing] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const loadDevices = useCallback(async () => {
    setLoadingList(true);
    setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      // Least recently used first: those are the likeliest to be spare.
      const { data, error: qErr } = await supabase
        .from("license_devices")
        .select("*")
        .eq("user_id", user.id)
        .order("last_seen_at", { ascending: true });
      if (qErr) throw new Error(qErr.message);
      setDevices(data || []);
    } catch (e) {
      setError(e?.message || "Could not load your devices.");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  // Re-running the license load retries registration; if a seat is now free
  // this device takes it and the gate disappears on its own.
  const tryAgain = useCallback(async () => {
    setChecking(true);
    try { await refreshLicense?.(); } finally { setChecking(false); }
  }, [refreshLicense]);

  const release = async (fingerprint) => {
    setReleasing(fingerprint);
    setError("");
    try {
      await licensingApi.detachDevice(fingerprint);
      setDevices((prev) => prev.filter((d) => d.fingerprint !== fingerprint));
      await tryAgain();
    } catch (e) {
      setError(e?.message || "Could not release that device.");
    } finally {
      setReleasing(null);
    }
  };

  const limit = deviceLimit?.limit ?? 1;
  const planName = PLAN_NAMES[String(gating?.plan || "free").toLowerCase()] || "current";
  const canUpgrade = !["yearly", "pro_yearly"].includes(String(gating?.plan || "").toLowerCase());

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-auto py-10 font-sans" style={{ fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div className="absolute inset-0" style={{ background: "linear-gradient(160deg, #3B82F6 0%, #2563EB 45%, #1E3A8A 100%)" }}>
        <img
          src={process.env.PUBLIC_URL + "/tone-preview.jpg"}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: 0.3, mixBlendMode: "luminosity" }}
        />
      </div>

      <div className="relative z-10 w-[92%] sm:w-[78%] md:w-[65%] lg:w-[60%] max-w-[600px] rounded-2xl bg-white dark:bg-slate-900 px-7 py-8 shadow-[0_8px_28px_rgba(15,23,42,0.16)]">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-500/15">
          <svg className="h-5 w-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>

        <h1 className="mt-5 text-[28px] leading-tight font-bold tracking-tight text-slate-900 dark:text-slate-100" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>
          This device can&apos;t be added yet
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Your {planName} plan covers <strong className="text-slate-700 dark:text-slate-200">{limit} booth {limit === 1 ? "device" : "devices"}</strong>, and
          {limit === 1 ? " it is" : " all of them are"} in use. Release one you no longer use and this device takes its place straight away.
        </p>

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            Using a seat
          </div>
          <div className="text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
            {devices.filter(takesSeat).length} of {limit}
          </div>
        </div>

        <div className="mt-2.5 space-y-2">
          {loadingList && [0, 1].map((i) => (
            <div key={i} className="h-[62px] animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}

          {!loadingList && devices.map((d) => (
            <div key={d.fingerprint} className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{deviceDisplayName(d)}</div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {deviceTypeLabel(d.device_type, d.platform)}
                  {d.app_version ? ` · v${d.app_version}` : ""} · last used {ago(d.last_seen_at)}
                  {!takesSeat(d) ? " · not updated yet, no seat" : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => release(d.fingerprint)}
                disabled={releasing !== null || checking}
                className="flex-shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-400 disabled:opacity-50"
              >
                {releasing === d.fingerprint ? "Releasing…" : "Release"}
              </button>
            </div>
          ))}

          {!loadingList && devices.length === 0 && !error && (
            <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 px-4 py-5 text-center text-sm text-slate-500 dark:text-slate-400">
              A seat has come free. Try again to add this device.
            </p>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</p>
        )}

        <p className="mt-3 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
          Releasing a device doesn&apos;t stop it mid-session. It keeps working until it next opens the app, then needs a free seat. Computers and tablets each take a seat. Phones and browsers used for Remote Booth never do.
        </p>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={tryAgain}
            disabled={checking || releasing !== null}
            className="flex h-11 flex-1 items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white shadow-md shadow-blue-200 dark:shadow-none transition hover:bg-blue-700 disabled:opacity-60"
          >
            {checking ? "Checking…" : "Try again"}
          </button>
          {canUpgrade && (
            <button
              type="button"
              onClick={() => {
                // Tablets have no Electron bridge, so fall back to the browser.
                const url = "https://studiophotuna.com/#pricing";
                if (window.system?.openExternal) window.system.openExternal(url);
                else window.open(url, "_blank", "noopener,noreferrer");
              }}
              className="flex h-11 flex-1 items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              See plans with more devices
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => logout?.()}
          className="mt-4 block w-full text-center text-xs font-semibold text-slate-400 dark:text-slate-500 underline-offset-4 hover:text-slate-600 dark:hover:text-slate-300 hover:underline"
        >
          Sign out and use a different account
        </button>
      </div>
    </div>
  );
}
