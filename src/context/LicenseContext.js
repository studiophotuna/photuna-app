import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../services/licensingApi';
import { useAuth } from './AuthContext';
import { supabase } from '../services/supabase.js';

const LicenseCtx = createContext(null);

export function useLicense() {
  return useContext(LicenseCtx);
}

function detectPlatform() {
  if (typeof window !== 'undefined' && window.process?.platform) return window.process.platform;
  if (typeof navigator !== 'undefined') {
    return navigator.userAgentData?.platform || navigator.platform || 'web';
  }
  return 'web';
}

function normalizePem(pem) {
  if (!pem) return pem;
  if (pem.includes('\n')) return pem;
  return pem
    .replace('-----BEGIN PUBLIC KEY-----', '-----BEGIN PUBLIC KEY-----\n')
    .replace('-----END PUBLIC KEY-----', '\n-----END PUBLIC KEY-----');
}

function getEnvPublicKey() {
  const vitePk =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    (import.meta.env.VITE_LICENSE_PUBLIC_KEY || import.meta.env.VITE_PUBLIC_KEY);
  const craPk =
    typeof process !== 'undefined' &&
    process.env &&
    (process.env.REACT_APP_LICENSE_PUBLIC_KEY || process.env.REACT_APP_PUBLIC_KEY);
  return vitePk || craPk || null;
}

// The website's capture-subscription-payment writes pro_monthly / pro_yearly
// while this app has always written monthly / yearly, and both land in the same
// licenses table. Folding them together here means every consumer downstream —
// PLAN_RANK, retention, the plan name shown in Billing — sees one spelling
// instead of each having to remember both.
function canonicalPlan(raw) {
  const v = String(raw ?? 'free').toLowerCase();
  if (v === 'pro_yearly') return 'yearly';
  if (v === 'pro_monthly' || v === 'pro') return 'monthly';
  return v;
}

function normalizeLicense(raw) {
  if (!raw) return null;
  return {
    ...raw,
    active: ['active', 'trialing'].includes(raw.state) && raw.plan !== 'free',
    expiresAt: raw.expiresAt || raw.expires_at || null,
    trialRedeemed: Boolean(raw.trialRedeemed || raw.trial_redeemed),
    trialExpired: Boolean(raw.trialExpired || raw.trial_expired),
  };
}

// Read license data directly from Supabase using the anon client + user JWT.
// Requires the "user_read_own_license" SELECT RLS policy on the licenses table
// (migration 018_secure_rls.sql). Returns null on network failure so callers
// fall back to the local cache — same behaviour as the old IPC path.
async function fetchLicenseDirect(userId) {
  try {
    const { data, error } = await supabase
      .from('licenses')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.warn('[license:direct] query error:', error.message);
      return null; // network/query failure → caller uses cache
    }

    // Query succeeded but no row → confirmed free (not a network failure)
    if (!data) return { plan: 'free', state: 'active', _synthetic: true };

    const plan      = canonicalPlan(data.plan);
    const expiresMs = data.expires_at ? new Date(data.expires_at).getTime() : null;
    const isExpired = expiresMs !== null && expiresMs < Date.now() && plan !== 'free';
    const isPaid    = plan !== 'free' && plan !== 'trial';

    return {
      plan,
      state:         isExpired ? 'expired' : (data.state || 'active'),
      expiresAt:     data.expires_at ?? null,
      trialRedeemed: Boolean(data.trial_redeemed),
      trialExpired:  isExpired && plan === 'trial',
      _synthetic:    false,
      entitlements:  isExpired ? {
        watermark: true, maxEvents: 1, templates: 3, prioritySupport: false,
        galleryTier: 'free', galleryAddon: false, galleryEnabled: false,
      } : {
        watermark:       data.watermark       ?? (isPaid ? false : true),
        maxEvents:       data.max_events      ?? (isPaid ? 100   : 1),
        templates:       data.templates       ?? (isPaid ? 25    : 3),
        prioritySupport: data.priority_support ?? (plan === 'yearly'),
        // Gallery is included with every paid plan — retention is what varies
        // by billing cycle (6 months monthly, 12 yearly), not access itself.
        // The legacy gallery_addon / gallery_tier columns are still honoured so
        // anyone who bought the retired add-on keeps what they paid for.
        galleryTier:     data.gallery_tier || (data.gallery_addon ? 'plus' : (isPaid ? 'included' : 'free')),
        galleryAddon:    Boolean(data.gallery_addon || (data.gallery_tier && data.gallery_tier !== 'free')),
        galleryEnabled:  Boolean(isPaid || data.gallery_addon || (data.gallery_tier && data.gallery_tier !== 'free')),
        galleryRetentionMonths: plan === 'yearly' ? 12 : (isPaid ? 6 : 0),
      },
    };
  } catch {
    return null;
  }
}

async function readLicenseCache(userId) {
  try {
    return await window.electron.invoke('license:cache-read', userId);
  } catch { return null; }
}

async function writeLicenseCache(userId, licenseData, signedLicense, publicKey) {
  try {
    await window.electron.invoke('license:cache-write', userId, { licenseData, signedLicense, publicKey });
  } catch { /* best-effort */ }
}

async function clearLicenseCache(userId) {
  try {
    await window.electron.invoke('license:cache-write', userId, { licenseData: null, signedLicense: null, publicKey: null });
  } catch { /* best-effort */ }
}

const PLAN_RANK = { free: 0, trial: 1, monthly: 2, pro_monthly: 2, pro: 2, yearly: 3, pro_yearly: 3 };

// Reasons where we trust the Supabase-sourced license data instead of requiring
// a signed JWT (JWT unavailable = no private key configured or API server down).
const SOFT_FAIL_REASONS = new Set(['no_license', 'no_public_key', 'no_verifier', 'init', 'signature_invalid']);

export function LicenseProvider({ children }) {
  const { user, profile, loading: authLoading } = useAuth();

  const [license, setLicense] = useState(null);
  const [signedLicense, setSignedLicense] = useState(null);
  const [publicKey, setPublicKey] = useState(null);
  const [usable, setUsable] = useState({ allow: false, reason: 'init' });
  const [loading, setLoading] = useState(true);
  // { limit, used } when this machine was refused a seat, otherwise null. Only
  // ever set from an explicit limit_reached answer — a network failure leaves it
  // alone, so an offline booth is never locked out by a check it could not make.
  const [deviceLimit, setDeviceLimit] = useState(null);

  const refreshLicense = useCallback(async () => {
    if (authLoading) return null;

    if (!user?.id) {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('device.attached.'))
        .forEach((k) => localStorage.removeItem(k));
      setLicense(null);
      setSignedLicense(null);
      setPublicKey(null);
      setUsable({ allow: false, reason: 'no_user' });
      setDeviceLimit(null);
      setLoading(false);
      return null;
    }

    setLoading(true);

    // Safety valve: never stay stuck on the loading screen for more than 8 seconds.
    const safetyTimer = setTimeout(() => setLoading(false), 8000);

    // Restore the local cache immediately so the UI shows the correct plan
    // while network requests are in flight — prevents the "Free" flash on Ctrl+R.
    const earlyCache = await readLicenseCache(user.id);
    if (earlyCache?.licenseData && (PLAN_RANK[earlyCache.licenseData.plan] ?? -1) > PLAN_RANK.free) {
      setLicense(normalizeLicense(earlyCache.licenseData));
      setSignedLicense(earlyCache.signedLicense || null);
      setPublicKey(earlyCache.publicKey || null);
    }

    try {
      // Device seat. Runs on every load rather than once per machine: the old
      // one-shot flag meant last_seen_at was never refreshed, so a booth in daily
      // use looked abandoned and the weekly 90-day prune would delete it. Only the
      // desktop app has a deviceId, so phones and browsers never take a seat.
      const fpRes = await (window.system?.getFingerprint?.() ?? Promise.resolve(null)).catch(() => null);
      if (fpRes?.ok && fpRes.deviceId) {
        try {
          const seat = await api.registerDevice({
            deviceId: fpRes.deviceId,
            legacyFingerprint: fpRes.fingerprint,
            platform: detectPlatform(),
          });
          setDeviceLimit(seat?.ok === false && seat.status === 'limit_reached'
            ? { limit: seat.limit, used: seat.used }
            : null);
        } catch (e) {
          console.warn('registerDevice failed', e);
        }
      }

      // Step 1 — read license directly from Supabase (anon client + RLS policy).
      // Supabase is the single authoritative source for plan data.
      const sbLicense = await fetchLicenseDirect(user.id);

      // Step 2 — try the API for the signed JWT (best-effort; failure is not fatal)
      let apiRes = null;
      try {
        apiRes = await api.licenseStatus();
      } catch (e) {
        console.warn('[license] API unavailable, using Supabase data:', e?.message);
      }

      // Supabase is authoritative. API result provides the signed JWT only.
      let licenseData = sbLicense ?? apiRes?.license ?? null;

      // If ALL live sources returned nothing, fall back to the local cache.
      const livePlanRank = PLAN_RANK[licenseData?.plan] ?? -1;
      if (livePlanRank < 0) {
        const cached = await readLicenseCache(user.id);
        if (cached?.licenseData) {
          console.info('[license] live data unavailable — restoring from local cache');
          setLicense(normalizeLicense(cached.licenseData));
          setSignedLicense(cached.signedLicense || null);
          setPublicKey(cached.publicKey || null);
          return { license: cached.licenseData };
        }
      } else if (livePlanRank >= 0 && livePlanRank <= PLAN_RANK.free) {
        // Live source confirmed free — evict any stale paid cache.
        clearLicenseCache(user.id);
      }

      if (!licenseData) {
        setUsable({ allow: false, reason: 'no_license_data' });
        return null;
      }

      const resolvedSignedLicense = apiRes?.signedLicense || null;
      const resolvedPublicKey = apiRes?.publicKey || null;

      setLicense(normalizeLicense(licenseData));
      setSignedLicense(resolvedSignedLicense);
      setPublicKey(resolvedPublicKey);

      if (sbLicense || apiRes) {
        writeLicenseCache(user.id, licenseData, resolvedSignedLicense, resolvedPublicKey);
      }

      return apiRes ?? { license: licenseData };
    } catch (err) {
      console.warn('license refresh failed', err);
      setUsable({ allow: false, reason: err?.message || 'license_status_failed' });
      return null;
    } finally {
      clearTimeout(safetyTimer);
      setLoading(false);
    }
  }, [authLoading, user?.id]);

  const refreshRef = useRef(refreshLicense);
  useEffect(() => { refreshRef.current = refreshLicense; }, [refreshLicense]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => { if (!cancelled) await refreshLicense(); };
    run();
    return () => { cancelled = true; };
  }, [refreshLicense]);

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      const token = signedLicense;
      const pk = normalizePem(publicKey || getEnvPublicKey());
      const expectedUserId = user?.id || null;

      if (!token) { setUsable({ allow: false, reason: 'no_license' }); return; }
      if (!pk) { setUsable({ allow: false, reason: 'no_public_key' }); return; }
      if (!expectedUserId) { setUsable({ allow: false, reason: 'no_subject' }); return; }
      if (!window.licenseVerifier) { setUsable({ allow: false, reason: 'no_verifier' }); return; }

      try {
        const verified = await window.licenseVerifier.verifySignedLicense(token, pk);
        const policy = window.licenseVerifier.isLicenseUsable(verified, {
          expectedIssuer: 'StudioPhotuna-Licensing',
          expectedType: 'license',
          expectedUserId,
        });
        if (!cancelled) setUsable(policy);
      } catch (e) {
        console.warn('[license] verification failed', e);
        if (!cancelled) setUsable({ allow: false, reason: 'signature_invalid' });
      }
    };

    verify();
    return () => { cancelled = true; };
  }, [signedLicense, publicKey, user?.id]);

  const ent = license?.entitlements || {};
  // licenseActive is true if the license JWT confirms an active paid plan,
  // OR if the Supabase profile row already reflects a paid plan (reliable fallback
  // when the JWT is unavailable or hasn't been fetched yet).
  // Consider any license with a past expires_at as expired, regardless of what
  // the DB state column says. This is what prevents a Ctrl+R from re-showing
  // the paid plan after the admin has set current_period_end to a past date.
  const isLicenseExpired = Boolean(
    license?.expiresAt != null && new Date(license.expiresAt).getTime() < Date.now()
  );

  const licenseActive = !isLicenseExpired && (
    (['active', 'trialing'].includes(license?.state) && license?.plan !== 'free')
    // Only use profile.subscription_plan as fallback when Supabase returned no license at all
    // (i.e. the licenses table row doesn't exist yet). When a license IS present, Supabase is
    // authoritative and a stale profiles row must not promote a free license to active.
    || (!license && ['monthly', 'yearly', 'trial', 'pro_monthly', 'pro_yearly', 'pro'].includes(profile?.subscription_plan))
  );

  const gating = useMemo(() => {
    // When JWT is unavailable (API down, no private key) but Supabase data
    // confirms an active plan, trust the Supabase data and allow access.
    const jwtSoftFail = !usable.allow && SOFT_FAIL_REASONS.has(usable.reason);
    const allow = usable.allow || (jwtSoftFail && licenseActive);

    return {
      allow,
      reason: usable.reason,
      plan: license?.plan || profile?.subscription_plan || null,
      state: license?.state || null,
      active: licenseActive,
      watermark: Boolean(ent.watermark),
      maxEvents: ent.maxEvents ?? 0,
      templates: ent.templates ?? 0,
      prioritySupport: Boolean(ent.prioritySupport),
      // Tiered gallery entitlement — consumers read the value (free|plus|business).
      galleryTier: ent.galleryTier || (ent.galleryAddon ? 'plus' : 'free'),
      galleryAddon: Boolean(ent.galleryAddon),
      galleryEnabled: Boolean(ent.galleryEnabled || ent.galleryAddon),
      expiresAt: license?.expiresAt || null,
    };
  }, [usable, ent, license, licenseActive, profile?.subscription_plan]);

  return (
    <LicenseCtx.Provider value={{ license, signedLicense, publicKey, gating, loading, refreshLicense, deviceLimit }}>
      {children}
    </LicenseCtx.Provider>
  );
}