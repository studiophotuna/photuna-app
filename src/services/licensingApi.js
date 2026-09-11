// licensingApi.js
// All operations use Supabase directly (anon client + RLS) or Supabase Edge Functions.
// No embedded Express server or secret keys are required in the distributed app.
import { supabase } from './supabase.js';

/* ─── Auth helper ─────────────────────────────────────────────────────────── */

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

async function invokeFunction(name, body) {
  const token = await getAccessToken();
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (error) throw new Error(error.message || String(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

/* ─── Discount code validation (direct Supabase, RLS-gated) ──────────────── */

const PHP_AMOUNTS = { monthly: 1800, yearly: 11400, plus: 900, business: 1700 };

export const validateDiscountCode = async (code, plan) => {
  const { data: discount, error } = await supabase
    .from('discount_codes')
    .select('*')
    .eq('code', String(code).trim().toUpperCase())
    .eq('is_active', true)
    .maybeSingle();

  if (error || !discount) return { valid: false, error: 'Code not found' };

  const now = new Date();
  if (discount.valid_from  && new Date(discount.valid_from)  > now) return { valid: false, error: 'Code is not yet valid' };
  if (discount.valid_until && new Date(discount.valid_until) < now) return { valid: false, error: 'Code has expired' };
  if (discount.max_uses !== null && discount.uses_count >= discount.max_uses) return { valid: false, error: 'Code limit reached' };
  if (discount.applies_to?.length > 0 && !discount.applies_to.includes(plan)) return { valid: false, error: 'Code is not valid for this plan' };

  const originalAmountPhp  = PHP_AMOUNTS[plan] ?? 0;
  let discountedAmountPhp  = originalAmountPhp;
  if (discount.discount_type === 'percent') {
    discountedAmountPhp = Math.max(0, Math.round(originalAmountPhp * (1 - discount.discount_value / 100)));
  } else {
    discountedAmountPhp = Math.max(0, originalAmountPhp - discount.discount_value);
  }

  return {
    valid: true,
    codeId: discount.id,
    discountType:       discount.discount_type,
    discountValue:      discount.discount_value,
    originalAmountPhp,
    discountedAmountPhp,
    savingsPhp:         originalAmountPhp - discountedAmountPhp,
    stripeCouponId:     discount.stripe_coupon_id || null,
  };
};

/* ─── PayMongo (Edge Functions) ───────────────────────────────────────────── */

export const createPayMongoLink = (planType, plan, discountCode) =>
  invokeFunction('create-paymongo-link', { planType, plan, discountCode: discountCode || null });

// plan/planType are no longer sent: the function reads both back from the
// link's own remarks, so the client cannot ask for a plan it did not pay for.
export const getPayMongoLinkStatus = (linkId) =>
  invokeFunction('paymongo-link-status', { linkId });

/* ─── License (direct Supabase, RLS-gated) ───────────────────────────────── */

export const licenseStatus = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not_authenticated');

  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  // Website-issued subscriptions arrive as pro_monthly / pro_yearly; fold them
  // onto this app's spelling so the entitlement checks below match. Same rule as
  // canonicalPlan in LicenseContext, applied at the other read path.
  const rawPlan = String(data?.plan ?? 'free').toLowerCase();
  const plan  = rawPlan === 'pro_yearly' ? 'yearly'
              : (rawPlan === 'pro_monthly' || rawPlan === 'pro') ? 'monthly'
              : rawPlan;
  const state = data?.state || 'active';
  const isPaid = plan !== 'free' && plan !== 'trial';
  const expiresAt = data?.expires_at ?? null;

  return {
    license: {
      plan, state, expiresAt,
      entitlements: {
        watermark:       data?.watermark       ?? !isPaid,
        maxEvents:       data?.max_events      ?? (isPaid ? 20 : 0),
        templates:       data?.templates       ?? (isPaid ? 30 : 3),
        prioritySupport: data?.priority_support ?? (plan === 'yearly'),
        // Gallery ships with every paid plan; only retention varies by cycle.
        // gallery_addon / gallery_tier are still honoured for anyone who bought
        // the retired add-on.
        galleryAddon:    Boolean(data?.gallery_addon),
        galleryEnabled:  Boolean(isPaid || data?.gallery_addon),
        galleryTier:     data?.gallery_tier || (data?.gallery_addon ? 'plus' : (isPaid ? 'included' : 'free')),
        galleryRetentionMonths: plan === 'yearly' ? 12 : (isPaid ? 6 : 0),
        plan,
      },
    },
    signedLicense: null,
    publicKey: null,
  };
};

export const redeemTrial = () => invokeFunction('redeem-trial', {});

/* ─── PayPal (subscription checkout) ──────────────────────────────────────
   Mirrors the PayMongo link flow: create, then poll until captured. The status
   call deliberately takes only the order id — the plan is read back from the
   order's custom_id server-side, so the client cannot name what it paid for. */

export const createPayPalOrder = (planType, plan, discountCode) =>
  invokeFunction('create-paypal-order', { planType, plan, discountCode: discountCode || null });

export const getPayPalOrderStatus = (orderId) =>
  invokeFunction('paypal-order-status', { orderId });

/* ─── Devices (direct Supabase, RLS-gated) ───────────────────────────────── */

// Registers this device against the account's device allowance, or refreshes
// it if already registered. Direct inserts into license_devices are refused by
// RLS (migration 021); register_device() is the only write path, because a
// count checked where the caller can go around it is not a limit.
//
// Resolves { ok, status, limit, used } where status is
// 'known' | 'migrated' | 'added' | 'limit_reached'. Throws only on transport or
// auth failure — callers must treat that as "unknown", never as "blocked", so a
// booth that is offline at an event keeps running.
export const registerDevice = async ({ deviceId, legacyFingerprint, platform, deviceName, deviceType, appVersion }) => {
  const { data, error } = await supabase.rpc('register_device', {
    p_fingerprint: deviceId,
    p_platform: platform || 'unknown',
    p_legacy_fingerprint: legacyFingerprint || null,
    // Identity so operators can tell devices apart (migration 022). Sent as
    // null rather than omitted when unknown; the function keeps the stored
    // value in that case.
    p_device_name: deviceName || null,
    p_device_type: deviceType || null,
    p_app_version: appVersion || null,
  });
  if (error) throw new Error(error.message);
  return data;
};

// { limit, used } for the signed-in account.
export const getDeviceAllowance = async () => {
  const { data, error } = await supabase.rpc('my_device_allowance');
  if (error) throw new Error(error.message);
  return data;
};

export const detachDevice = async (fingerprint) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not_authenticated');

  // The result used to be ignored, so a failed delete still reported success
  // and a device that was never released looked released — which now matters,
  // because releasing is how an operator frees a seat.
  const { error } = await supabase.from('license_devices')
    .delete()
    .eq('user_id', user.id)
    .eq('fingerprint', fingerprint);
  if (error) throw new Error(error.message);
  return { ok: true };
};

// Operator's own label for a device ("Front booth"). An empty name clears it
// back to the device's own name. Resolves false if the device is not theirs.
export const renameDevice = async (fingerprint, name) => {
  const { data, error } = await supabase.rpc('rename_device', {
    p_fingerprint: fingerprint,
    p_name: name ?? '',
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
};

/* ─── Profile ─────────────────────────────────────────────────────────────── */

export const me = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not_authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  return {
    user: {
      id:         user.id,
      email:      user.email,
      name:       profile?.name || profile?.full_name || user.user_metadata?.full_name || null,
      avatar_url: profile?.avatar_url || null,
      ...profile,
    },
  };
};

export const updateUserProfile = async (patch) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not_authenticated');

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select()
    .maybeSingle();

  if (error) throw new Error(error.message);
  return { profile: data };
};

export const uploadAvatar = async (file) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not_authenticated');

  const ext  = file.type?.split('/')[1] || 'jpg';
  const path = `${user.id}/avatar.${ext}`;
  const buf  = await file.arrayBuffer();

  const { error: uploadErr } = await supabase.storage
    .from('avatars')
    .upload(path, buf, { contentType: file.type || 'image/jpeg', upsert: true });

  if (uploadErr) throw new Error(uploadErr.message);

  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
  await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
  return { ok: true, avatar_url: publicUrl };
};

export const changePassword = async (currentPassword, newPassword) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not_authenticated');

  // Verify current password by re-authenticating
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInErr) throw new Error('Current password is incorrect');

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
  return { ok: true };
};

/* ─── Gallery QR (direct Supabase, RLS-gated) ────────────────────────────── */

const GALLERY_BASE_URL = 'https://gallery.studiophotuna.com/gallery';

export const getEventGallerySessions = async (eventId) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, sessions: [], error: 'not_authenticated' };

  const { data, error } = await supabase
    .from('galleries')
    .select('slug, session_id, final_url, final_video_url, expires_at, created_at')
    .eq('event_id', eventId)
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return { ok: false, sessions: [], error: error.message };
  return {
    ok: true,
    sessions: (data || []).map((row) => ({
      slug: row.slug,
      sessionId: row.session_id,
      qrUrl: `${GALLERY_BASE_URL}/${row.slug}`,
      finalUrl: row.final_url,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    })),
  };
};

export const createEventGalleryQr = async (eventId, galleryTier = 'free') => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  const { data: existing } = await supabase
    .from('galleries')
    .select('slug, expires_at, gallery_tier')
    .eq('event_id', eventId)
    .is('session_id', null)
    .maybeSingle();

  if (existing?.slug) {
    if (!existing.gallery_tier || existing.gallery_tier !== galleryTier) {
      await supabase.from('galleries').update({ gallery_tier: galleryTier })
        .eq('event_id', eventId).is('session_id', null);
    }
    return { ok: true, slug: existing.slug, qrUrl: `${GALLERY_BASE_URL}/${existing.slug}`, expiresAt: existing.expires_at, isNew: false };
  }

  const slug = `evt-${String(eventId).replace(/-/g, '').slice(0, 12)}-${Date.now().toString(36)}`;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from('galleries').insert({
    slug,
    event_id: eventId,
    session_id: null,
    owner_user_id: user.id,
    final_url: null,
    expires_at: expiresAt,
    gallery_tier: galleryTier,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, slug, qrUrl: `${GALLERY_BASE_URL}/${slug}`, expiresAt, isNew: true };
};

/* ─── Stripe (not configured — stubs so callers get a clear error) ────────── */

export const createStripeCheckoutSession = () =>
  Promise.reject(new Error('stripe_not_configured'));

export const createGalleryAddonSession = () =>
  Promise.reject(new Error('stripe_not_configured'));

export const getBillingSubscription = () =>
  Promise.reject(new Error('stripe_not_configured'));

export const createBillingPortalSession = () =>
  Promise.reject(new Error('stripe_not_configured'));

/* ─── Admin (stubs — use the website admin panel for these operations) ─────── */

export const adminSetSubscription  = () => Promise.reject(new Error('use_admin_panel'));
export const adminStartTrial       = () => Promise.reject(new Error('use_admin_panel'));
export const adminRevokeSubscription = () => Promise.reject(new Error('use_admin_panel'));

/* ─── Unused legacy exports (kept so old callers don't crash) ─────────────── */

export const licenseRefresh = licenseStatus;
export const setPlan        = () => Promise.reject(new Error('use_paymongo_flow'));
