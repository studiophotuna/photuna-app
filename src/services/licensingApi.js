import { supabase } from '../services/supabase.js';

const API = process.env.REACT_APP_API_URL || 'http://localhost:8080';

// Cache the token via an auth-state subscriber so every API request doesn't
// call getSession() — concurrent getSession() calls fight for the navigator
// lock and cause "lock was released because another request stole it" errors.
let _cachedToken = null;

supabase.auth.onAuthStateChange((_event, session) => {
  _cachedToken = session?.access_token ?? null;
});

async function getAccessToken({ forceRefresh = false } = {}) {
  if (_cachedToken && !forceRefresh) return _cachedToken;
  if (forceRefresh) {
    // refreshSession() explicitly asks the auth server for a new access token —
    // getSession() can return the stale cached token if auto-refresh hasn't fired.
    const { data, error } = await supabase.auth.refreshSession();
    if (error) {
      // Refresh token itself is expired — session is gone, sign out cleanly.
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('Session expired. Please sign in again.');
    }
    _cachedToken = data?.session?.access_token ?? null;
  } else {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message || 'Unable to get Supabase session');
    _cachedToken = data?.session?.access_token ?? null;
  }
  return _cachedToken;
}

async function request(path, { method = 'GET', body, auth = true, headers = {} } = {}, _retried = false) {
  const token = auth ? await getAccessToken() : null;

  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && !_retried) {
    await getAccessToken({ forceRefresh: true });
    return request(path, { method, body, auth, headers }, true);
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const payload = await res.json();
      message = payload?.error || payload?.message || message;
    } catch {
      const text = await res.text().catch(() => '');
      message = text || message;
    }
    throw new Error(message);
  }

  const contentType = res.headers.get('content-type') || '';
  return contentType.includes('application/json') ? res.json() : res.text();
}

/* =========================
   Billing — Stripe Checkout
========================= */

// Returns { url } — open in system browser via shell.openExternal
export const createStripeCheckoutSession = (plan, discountCode) =>
  request('/billing/create-checkout-session', {
    method: 'POST',
    body: discountCode ? { plan, discountCode } : { plan },
  });

export const createGalleryAddonSession = () =>
  request('/billing/create-gallery-addon-session', { method: 'POST' });

export const getBillingSubscription = () =>
  request('/billing/subscription');

export const createBillingPortalSession = () =>
  request('/billing/portal', { method: 'POST' });

/* =========================
   Billing — PayMongo (legacy, kept for booth guest payments)
========================= */

export const validateDiscountCode = (code, plan) =>
  request('/billing/validate-discount-code', {
    method: 'POST',
    body: { code, plan },
  });

export const createPayMongoLink = (planType, plan, discountCode) =>
  request('/billing/create-paymongo-link', {
    method: 'POST',
    body: discountCode ? { planType, plan, discountCode } : { planType, plan },
  });

export const getPayMongoLinkStatus = (linkId, planType, plan) =>
  request(`/billing/paymongo-link-status?linkId=${encodeURIComponent(linkId)}&planType=${encodeURIComponent(planType)}&plan=${encodeURIComponent(plan)}`);

/* =========================
   License
========================= */

export const licenseStatus = () => request('/license/status');

export const licenseRefresh = () => request('/license/refresh', { method: 'POST' });

export const attachDevice = (fingerprint, platform) =>
  request('/license/attach-device', {
    method: 'POST',
    body: { fingerprint, platform },
  });

export const detachDevice = (fingerprint) =>
  request('/license/detach-device', {
    method: 'POST',
    body: { fingerprint },
  });

export const redeemTrial = () =>
  request('/license/redeem-trial', { method: 'POST' });

/**
 * Test/dev only. Production upgrades should go through createPayMongoLink().
 */
export const setPlan = (plan) =>
  request('/license/set-plan', {
    method: 'POST',
    body: { plan },
  });

/* =========================
   Profile
========================= */

export const me = () => request('/me');

export const updateUserProfile = (profile) =>
  request('/me', {
    method: 'PUT',
    body: profile,
  });

// Upload a raw image file as the user's avatar; returns { ok, avatar_url }.
export async function uploadAvatar(file) {
  const token = await getAccessToken();
  // Read as ArrayBuffer first — sending a File object directly through Electron's
  // fetch stack can produce an empty body at the Express layer.
  const arrayBuffer = await file.arrayBuffer();
  const res = await fetch(`${API}/me/avatar`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'image/jpeg',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: arrayBuffer,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const p = await res.json(); message = p?.error || message; } catch {}
    throw new Error(message);
  }
  return res.json();
}

// Change the current user's password after verifying their current password.
export const changePassword = (currentPassword, newPassword) =>
  request('/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });

/* =========================
   Admin
========================= */

export const adminSetSubscription = (userId, payload) =>
  request(`/admin/users/${userId}/subscription`, {
    method: 'POST',
    body: payload,
  });

export const adminStartTrial = (userId, days = 7) =>
  request(`/admin/users/${userId}/trial`, {
    method: 'POST',
    body: { days },
  });

export const adminRevokeSubscription = (userId) =>
  request(`/admin/users/${userId}/subscription`, {
    method: 'DELETE',
  });
