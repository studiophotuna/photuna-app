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

export const getPayMongoLinkStatus = (linkId, planType, plan) =>
  invokeFunction('paymongo-link-status', { linkId, planType, plan });

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

  const plan  = data?.plan  || 'free';
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
        galleryAddon:    Boolean(data?.gallery_addon),
        galleryEnabled:  Boolean(data?.gallery_addon),
        galleryTier:     data?.gallery_tier || (data?.gallery_addon ? 'plus' : 'free'),
        plan,
      },
    },
    signedLicense: null,
    publicKey: null,
  };
};

export const redeemTrial = () => invokeFunction('redeem-trial', {});

/* ─── Devices (direct Supabase, RLS-gated) ───────────────────────────────── */

export const attachDevice = async (fingerprint, platform) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not_authenticated');

  const { error } = await supabase.from('license_devices').upsert(
    { user_id: user.id, fingerprint, platform: platform || 'unknown', last_seen_at: new Date().toISOString() },
    { onConflict: 'user_id,fingerprint' }
  );
  if (error) throw new Error(error.message);
  return { ok: true };
};

export const detachDevice = async (fingerprint) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not_authenticated');

  await supabase.from('license_devices')
    .delete()
    .eq('user_id', user.id)
    .eq('fingerprint', fingerprint);
  return { ok: true };
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
