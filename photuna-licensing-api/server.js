
// photuna-licensing-api/server.js
// NOTE: This standalone server is for development/testing only (runs on port 8081).
// The Electron app embeds its own API server on port 8080 (electron/main.js →
// startBillingApiServer). Do NOT run this alongside the Electron app — they
// share the same Supabase project and Stripe keys, but the embedded server is
// what the React renderer actually talks to.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });


const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const { nanoid } = require('nanoid');
const { db, get, all, run, transaction } = require('./db');

const app = express();

const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/** ====== Core config ====== */
const {
  PORT = 8080,
  NODE_ENV = 'development',
  CORS_ORIGIN = '*',

  ACCESS_TOKEN_SECRET,
  ACCESS_TOKEN_TTL = '15m',
  REFRESH_TOKEN_SECRET,
  REFRESH_TOKEN_TTL = '30d',

  LICENSE_PRIVATE_KEY,
  LICENSE_PUBLIC_KEY,
  LICENSE_MAX_OFFLINE_DAYS = '7',

  TRIAL_DAYS = '14',
  TRIAL_DEVICE_LIMIT = '1',
  MONTHLY_DEVICE_LIMIT = '2',
  YEARLY_DEVICE_LIMIT = '3',

  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_MONTHLY,
  STRIPE_PRICE_YEARLY,
  STRIPE_PRICE_GALLERY_ADDON_MONTHLY,
  BILLING_SUCCESS_URL,
  BILLING_CANCEL_URL,
  BILLING_PORTAL_RETURN_URL,
  DISPLAY_PRICE_GALLERY_ADDON_PHP = '₱499 / mo',
  GOOGLE_PLACES_API_KEY,
  GOOGLE_PLACE_ID,
  GOOGLE_REVIEWS_CACHE_TTL_MS = '3600000'
} = process.env;

if (!ACCESS_TOKEN_SECRET || !REFRESH_TOKEN_SECRET) {
  console.warn('[WARN] ACCESS/REFRESH secrets are not set. Set them in .env');
}
if (!LICENSE_PRIVATE_KEY || !LICENSE_PUBLIC_KEY) {
  console.warn('[WARN] License signing keys are not set. Offline license wont work.');
}

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const googleReviewsCache = {
  expiresAt: 0,
  payload: null,
};

/** ====== Middleware ====== */
// Stripe webhook needs raw body. So mount JSON normally, but the webhook route will override.
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '2mb' }));

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});

/** ====== Utilities ====== */
const DAY_S = 24 * 3600;
const BCRYPT_ROUNDS = 10;

function nowSec() { return Math.floor(Date.now() / 1000); }

// Wrap any Supabase query with a hard timeout so a paused/slow project
// never hangs the server response indefinitely.
function sbQuery(queryPromise, ms = 9000) {
  return Promise.race([
    queryPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Supabase query timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function planEntitlements(plan) {
  switch (plan) {
    case 'trial':
      return { watermark: true, maxEvents: 3, templates: 5, prioritySupport: false, galleryAddon: false, galleryEnabled: false, plan: 'trial' };
    case 'monthly':
      return { watermark: false, maxEvents: 20, templates: 30, prioritySupport: false, galleryAddon: false, galleryEnabled: false, plan: 'monthly' };
    case 'yearly':
      return { watermark: false, maxEvents: 50, templates: 100, prioritySupport: true, galleryAddon: false, galleryEnabled: false, plan: 'yearly' };
    default:
      return { watermark: true, maxEvents: 0, templates: 0, prioritySupport: false, galleryAddon: false, galleryEnabled: false, plan: 'free' };
  }
}

function deviceLimitForPlan(plan) {
  if (plan === 'yearly') return parseInt(YEARLY_DEVICE_LIMIT, 10);
  if (plan === 'monthly') return parseInt(MONTHLY_DEVICE_LIMIT, 10);
  return parseInt(TRIAL_DEVICE_LIMIT, 10);
}

function normalizeGoogleReview(review = {}) {
  const author = review.authorAttribution || {};
  return {
    authorName: author.displayName || 'Google reviewer',
    authorPhotoUrl: author.photoUri || null,
    authorUrl: author.uri || null,
    rating: review.rating || null,
    text: review.text?.text || review.originalText?.text || '',
    languageCode: review.text?.languageCode || review.originalText?.languageCode || null,
    relativeTime: review.relativePublishTimeDescription || '',
    publishTime: review.publishTime || null,
    reviewUrl: review.googleMapsUri || author.uri || null,
  };
}

async function fetchGoogleReviews() {
  if (!GOOGLE_PLACES_API_KEY || !GOOGLE_PLACE_ID) {
    return {
      configured: false,
      rating: null,
      userRatingCount: null,
      reviews: [],
      error: 'Google reviews API is not configured',
    };
  }

  const now = Date.now();
  if (googleReviewsCache.payload && googleReviewsCache.expiresAt > now) {
    return googleReviewsCache.payload;
  }

  const placeName = GOOGLE_PLACE_ID.startsWith('places/')
    ? GOOGLE_PLACE_ID
    : `places/${GOOGLE_PLACE_ID}`;
  const fields = [
    'id',
    'displayName',
    'rating',
    'userRatingCount',
    'googleMapsUri',
    'reviews',
  ].join(',');
  const url = `https://places.googleapis.com/v1/${encodeURIComponent(placeName).replace('%2F', '/')}?fields=${encodeURIComponent(fields)}&key=${encodeURIComponent(GOOGLE_PLACES_API_KEY)}`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || `Google Places request failed with ${response.status}`;
    throw new Error(message);
  }

  const payload = {
    configured: true,
    source: 'google-places',
    placeId: data.id || GOOGLE_PLACE_ID,
    placeName: data.displayName?.text || 'Studio Photuna',
    googleMapsUri: data.googleMapsUri || null,
    rating: data.rating || null,
    userRatingCount: data.userRatingCount || null,
    reviews: Array.isArray(data.reviews) ? data.reviews.map(normalizeGoogleReview) : [],
    fetchedAt: new Date().toISOString(),
  };

  googleReviewsCache.payload = payload;
  googleReviewsCache.expiresAt = now + Math.max(60_000, parseInt(GOOGLE_REVIEWS_CACHE_TTL_MS, 10) || 3_600_000);
  return payload;
}

/** ====== Supabase License Helpers (primary store) ====== */

// Read a license row from Supabase; returns null on any failure
async function getSupabaseLicense(userId) {
  try {
    const { data, error } = await sbQuery(
      supabaseAdmin.from('licenses').select('*').eq('user_id', userId).maybeSingle()
    );
    if (error) { console.warn('[sb] getSupabaseLicense', error.message); return null; }
    return data || null;
  } catch (e) {
    console.warn('[sb] getSupabaseLicense exception', e.message);
    return null;
  }
}

// Convert a Supabase license row to the internal format used throughout this file
function sbRowToInternal(row) {
  if (!row) return null;
  const expires = row.expires_at
    ? Math.floor(new Date(row.expires_at).getTime() / 1000)
    : 0;
  return {
    plan: row.plan,
    state: row.state,
    current_period_end: expires,
    trial_redeemed: row.trial_redeemed || false,
    entitlements: {
      watermark: row.watermark,
      maxEvents: row.max_events,
      templates: row.templates,
      prioritySupport: row.priority_support,
      galleryAddon: Boolean(row.gallery_addon),
      galleryEnabled: Boolean(row.gallery_addon),
      plan: row.plan,
    },
  };
}

// Upsert a license into Supabase; returns { ok, error } for caller visibility.
// Hard 9 s timeout prevents a paused/slow Supabase project from blocking responses.
async function upsertSupabaseLicense(userId, { plan, state, expires, entitlements, trialRedeemed }) {
  try {
    const existing = await getSupabaseLicense(userId);

    // Prefer the admin-set current_period_end over any computed expiry value.
    // This ensures manual activations never stomp the date the admin recorded.
    const adminPeriodEnd = existing?.current_period_end || null;
    const resolvedExpiresAt = adminPeriodEnd
      ? new Date(adminPeriodEnd * 1000).toISOString()
      : (expires ? new Date(expires * 1000).toISOString() : null);

    const { error } = await sbQuery(
      supabaseAdmin.from('licenses').upsert(
        {
          user_id: userId,
          plan,
          state,
          expires_at: resolvedExpiresAt,
          watermark: entitlements.watermark,
          max_events: entitlements.maxEvents,
          templates: entitlements.templates,
          priority_support: entitlements.prioritySupport,
          gallery_addon: Boolean(existing?.gallery_addon),
          stripe_gallery_subscription_id: existing?.stripe_gallery_subscription_id || null,
          ...(trialRedeemed !== undefined ? { trial_redeemed: trialRedeemed } : {}),
        },
        { onConflict: 'user_id' }
      )
    );
    if (error) {
      console.error('[sb] upsertSupabaseLicense FAILED | userId:', userId,
        '| code:', error.code, '| message:', error.message,
        '| details:', error.details, '| hint:', error.hint);
      return { ok: false, error: error.message };
    }
    // Sync subscription_plan on the profile row (best-effort, own timeout)
    sbQuery(
      supabaseAdmin.from('profiles').update({ subscription_plan: plan }).eq('id', userId)
    ).then(({ error: profileErr }) => {
      if (profileErr) console.warn('[sb] profile subscription_plan update failed:', profileErr.message);
    }).catch((e) => console.warn('[sb] profile subscription_plan update timed out:', e.message));

    return { ok: true };
  } catch (e) {
    console.error('[sb] upsertSupabaseLicense exception:', e.message, '| userId:', userId);
    return { ok: false, error: e.message };
  }
}

async function setSupabaseGalleryAddon(userId, enabled, extra = {}) {
  try {
    const existing = await getSupabaseLicense(userId);
    const baseEntitlements = existing
      ? {
          max_events: existing.max_events ?? planEntitlements('free').maxEvents,
          templates: existing.templates ?? planEntitlements('free').templates,
          watermark: existing.watermark ?? planEntitlements('free').watermark,
          priority_support: existing.priority_support ?? planEntitlements('free').prioritySupport,
        }
      : {
          max_events: planEntitlements('free').maxEvents,
          templates: planEntitlements('free').templates,
          watermark: planEntitlements('free').watermark,
          priority_support: planEntitlements('free').prioritySupport,
        };

    const { error } = await sbQuery(
      supabaseAdmin.from('licenses').upsert(
        {
          user_id: userId,
          plan: existing?.plan || 'free',
          state: existing?.state || 'active',
          expires_at: existing?.expires_at || null,
          trial_redeemed: Boolean(existing?.trial_redeemed),
          ...baseEntitlements,
          gallery_addon: Boolean(enabled),
          ...extra,
        },
        { onConflict: 'user_id' }
      )
    );

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Sync a license into SQLite (used as offline fallback cache after a Supabase read/write)
function syncToSQLite(userId, { plan, state, current_period_end, entitlements }) {
  try {
    const existing = get(`SELECT id FROM licenses WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`, [userId]);
    if (existing) {
      run(
        `UPDATE licenses SET plan=?, state=?, entitlements_json=?, current_period_end=?, updated_at=datetime('now') WHERE id=?`,
        [plan, state, JSON.stringify(entitlements), current_period_end || 0, existing.id]
      );
    } else {
      run(
        `INSERT INTO licenses (id, user_id, plan, state, entitlements_json, current_period_end) VALUES (?,?,?,?,?,?)`,
        [nanoid(), userId, plan, state, JSON.stringify(entitlements), current_period_end || 0]
      );
    }
  } catch (e) {
    console.warn('[sqlite] syncToSQLite', e.message);
  }
}

// Get device count from Supabase license_devices; returns null on failure
async function getSupabaseDeviceCount(userId) {
  try {
    const { count, error } = await supabaseAdmin
      .from('license_devices')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error) return null;
    return count;
  } catch {
    return null;
  }
}

// Upsert a device into Supabase license_devices; returns true on success
async function upsertSupabaseDevice(userId, fingerprint, platform) {
  try {
    const { error } = await supabaseAdmin.from('license_devices').upsert(
      { user_id: userId, fingerprint, platform: platform || 'unknown', last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id,fingerprint' }
    );
    if (error) { console.warn('[sb] upsertSupabaseDevice', error.message); return false; }
    return true;
  } catch (e) {
    console.warn('[sb] upsertSupabaseDevice exception', e.message);
    return false;
  }
}

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}
function signRefreshToken(user) {
  const token = jwt.sign({ sub: user.id }, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_TTL });
  const decoded = jwt.decode(token);
  run(`INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?,?,?,?)`, [
    nanoid(), user.id, token, decoded.exp
  ]);
  return token;
}

async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'missing_token' });

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: 'invalid_supabase_token' });
    }

    req.user = {
      id: data.user.id,
      email: data.user.email,
    };

    next();
  } catch (err) {
    console.error('authMiddleware error', err);
    return res.status(401).json({ error: 'auth_failed' });
  }
}

function signLicenseJWT({ userId, plan, entitlements, expSeconds }) {
  // Sign with RS256 private key so client can verify with public key offline
  if (!LICENSE_PRIVATE_KEY) return null;
  const payload = {
    sub: userId,
    plan,
    entitlements,
    iat: nowSec(),
    exp: expSeconds,
    iss: 'StudioPhotuna-Licensing',
    typ: 'license'
  };
  return jwt.sign(payload, LICENSE_PRIVATE_KEY, { algorithm: 'RS256' });
}

/** ====== Auth Routes ====== */
app.post('/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });

    const existing = get(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'email_in_use' });

    const id = nanoid();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    run(`INSERT INTO users (id, email, password_hash, name) VALUES (?,?,?,?)`, [
      id, email.toLowerCase(), hash, name || null
    ]);
    const user = { id, email: email.toLowerCase() };
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    return res.status(201).json({ accessToken, refreshToken, user: { id, email, name: name || null } });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const row = get(`SELECT * FROM users WHERE email = ?`, [String(email || '').toLowerCase()]);
    if (!row) return res.status(401).json({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(password || '', row.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const user = { id: row.id, email: row.email };
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    return res.json({ accessToken, refreshToken, user: { id: row.id, email: row.email, name: row.name } });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

app.post('/auth/refresh', authLimiter, (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'missing_refresh_token' });
  try {
    const payload = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
    const row = get(`SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0`, [refreshToken]);
    if (!row) return res.status(401).json({ error: 'invalid_refresh_token' });
    const user = get(`SELECT id, email FROM users WHERE id = ?`, [payload.sub]);
    if (!user) return res.status(401).json({ error: 'user_not_found' });
    // Optionally rotate: mark old revoked and issue new
    run(`UPDATE refresh_tokens SET revoked = 1 WHERE token = ?`, [refreshToken]);
    const newAccess = signAccessToken(user);
    const newRefresh = signRefreshToken(user);
    return res.json({ accessToken: newAccess, refreshToken: newRefresh });
  } catch (err) {
    return res.status(401).json({ error: 'invalid_refresh_token' });
  }
});

app.post('/auth/logout', authMiddleware, (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    run(`UPDATE refresh_tokens SET revoked = 1 WHERE token = ?`, [refreshToken]);
  }
  return res.json({ ok: true });
});

app.get('/me', authMiddleware, (req, res) => {
  const user = get(`SELECT id, email, name, created_at FROM users WHERE id = ?`, [req.user.id]);
  return res.json({ user });
});


app.post('/license/plan', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { plan } = req.body || {};

    const allowed = new Set(['free', 'trial']);
    if (process.env.TESTING === 'true') { allowed.add('monthly'); allowed.add('yearly'); }
    if (!allowed.has(plan)) return res.status(400).json({ error: 'invalid_plan' });

    if (plan === 'trial') {
      const existing = await getSupabaseLicense(userId);
      const alreadyRedeemed = existing?.trial_redeemed
        ?? Boolean(get(`SELECT id FROM licenses WHERE user_id = ? AND trial_redeemed = 1`, [userId]));
      if (alreadyRedeemed) return res.status(409).json({ error: 'trial_already_redeemed' });
    }

    const entitlements = planEntitlements(plan);
    let expires = 0, state = 'active';
    if (plan === 'trial') { expires = nowSec() + (parseInt(TRIAL_DAYS, 10) * DAY_S); state = 'trialing'; }
    else if (plan === 'monthly') { expires = nowSec() + 30 * DAY_S; }
    else if (plan === 'yearly') { expires = nowSec() + 365 * DAY_S; }

    // Supabase first, SQLite as fallback
    await upsertSupabaseLicense(userId, { plan, state, expires, entitlements });
    syncToSQLite(userId, { plan, state, current_period_end: expires, entitlements });

    const licenseJWTExp = Math.min(
      expires || (nowSec() + parseInt(LICENSE_MAX_OFFLINE_DAYS, 10) * DAY_S),
      nowSec() + parseInt(LICENSE_MAX_OFFLINE_DAYS, 10) * DAY_S
    );
    const signedLicense = signLicenseJWT({ userId, plan, entitlements, expSeconds: licenseJWTExp });

    return res.json({
      license: { plan, state, expiresAt: expires, entitlements },
      signedLicense,
      publicKey: LICENSE_PUBLIC_KEY || null
    });
  } catch (err) {
    console.error('license/plan error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});



/** ====== Licensing Routes ====== */
app.post('/license/redeem-trial', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  // Check Supabase first, fall back to SQLite
  const sbLic = await getSupabaseLicense(userId);
  const alreadyRedeemed = sbLic
    ? sbLic.trial_redeemed
    : Boolean(get(`SELECT id FROM licenses WHERE user_id = ? AND plan = 'trial'`, [userId]));
  if (alreadyRedeemed) return res.status(409).json({ error: 'trial_already_redeemed' });

  const expires = nowSec() + (parseInt(TRIAL_DAYS, 10) * DAY_S);
  const entitlements = planEntitlements('trial');
  const licenseJWTExp = Math.min(expires, nowSec() + (parseInt(LICENSE_MAX_OFFLINE_DAYS, 10) * DAY_S));

  await upsertSupabaseLicense(userId, {
    plan: 'trial', state: 'trialing', expires, entitlements, trialRedeemed: true,
  });
  syncToSQLite(userId, { plan: 'trial', state: 'trialing', current_period_end: expires, entitlements });

  const signedLicense = signLicenseJWT({ userId, plan: 'trial', entitlements, expSeconds: licenseJWTExp });
  return res.json({
    license: { plan: 'trial', state: 'trialing', expiresAt: expires, entitlements },
    signedLicense,
    publicKey: LICENSE_PUBLIC_KEY || null
  });
});

app.get('/license/status', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  // Try Supabase first; fall back to SQLite
  const sbRow = await getSupabaseLicense(userId);
  let internal = sbRowToInternal(sbRow);

  if (!internal) {
    const lic = get(`
      SELECT * FROM licenses WHERE user_id = ?
      ORDER BY CASE state
        WHEN 'active' THEN 1 WHEN 'trialing' THEN 2
        WHEN 'past_due' THEN 3 WHEN 'canceled' THEN 4
        WHEN 'expired' THEN 5 ELSE 6 END
      LIMIT 1
    `, [userId]);

    if (lic) {
      internal = {
        plan: lic.plan,
        state: lic.state,
        current_period_end: lic.current_period_end || 0,
        entitlements: JSON.parse(lic.entitlements_json),
      };
    }
  } else {
    // Got a fresh Supabase value — keep SQLite in sync for offline use
    syncToSQLite(userId, internal);
  }

  let { plan, state, current_period_end: expires, entitlements } = internal || {
    plan: 'free', state: 'active', current_period_end: 0, entitlements: planEntitlements('free'),
  };

  if (expires && nowSec() > expires && state !== 'canceled') state = 'expired';

  const licenseJWTExp = Math.min(
    expires || nowSec() + (parseInt(LICENSE_MAX_OFFLINE_DAYS, 10) * DAY_S),
    nowSec() + (parseInt(LICENSE_MAX_OFFLINE_DAYS, 10) * DAY_S)
  );
  const signedLicense = signLicenseJWT({ userId, plan, entitlements, expSeconds: licenseJWTExp });

  return res.json({
    license: { plan, state, expiresAt: expires, entitlements },
    signedLicense,
    publicKey: LICENSE_PUBLIC_KEY || null
  });
});

app.post('/license/attach-device', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { fingerprint, platform } = req.body || {};
  if (!fingerprint) return res.status(400).json({ error: 'missing_fingerprint' });

  // Resolve plan — Supabase first, SQLite fallback
  const sbRow = await getSupabaseLicense(userId);
  const plan = sbRow?.plan || get(`
    SELECT plan FROM licenses WHERE user_id = ?
    ORDER BY CASE state WHEN 'active' THEN 1 WHEN 'trialing' THEN 2 ELSE 3 END, updated_at DESC LIMIT 1
  `, [userId])?.plan || 'free';

  const limit = deviceLimitForPlan(plan);

  // Device count — Supabase first, SQLite fallback
  const sbCount = await getSupabaseDeviceCount(userId);
  const count = sbCount !== null
    ? sbCount
    : (get(`SELECT COUNT(1) as c FROM devices WHERE user_id = ?`, [userId])?.c ?? 0);

  if (count >= limit) return res.status(403).json({ error: 'device_limit_reached', limit });

  // Write to Supabase first, SQLite as backup
  const sbOk = await upsertSupabaseDevice(userId, fingerprint, platform);
  if (!sbOk) {
    try {
      run(`INSERT INTO devices (id, user_id, fingerprint, platform) VALUES (?,?,?,?)`, [
        nanoid(), userId, fingerprint, platform || null
      ]);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        run(`UPDATE devices SET last_seen = datetime('now') WHERE user_id = ? AND fingerprint = ?`, [userId, fingerprint]);
        return res.json({ ok: true, alreadyAttached: true });
      }
      console.error('attach-device error', err);
      return res.status(500).json({ error: 'server_error' });
    }
  }

  return res.json({ ok: true });
});

app.post('/license/detach-device', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { fingerprint } = req.body || {};
  if (!fingerprint) return res.status(400).json({ error: 'missing_fingerprint' });

  await supabaseAdmin
    .from('license_devices')
    .delete()
    .eq('user_id', userId)
    .eq('fingerprint', fingerprint)
    .catch((e) => console.warn('[sb] detach-device', e.message));

  run(`DELETE FROM devices WHERE user_id = ? AND fingerprint = ?`, [userId, fingerprint]);
  return res.json({ ok: true });
});

/** ====== Billing — Discount Code Helpers ====== */

// PHP amounts used for discount calculations (same values as PAYMONGO_PLAN_AMOUNTS but in PHP, not centavos)
const DISCOUNT_PHP_AMOUNTS = { monthly: 1800, yearly: 11400, plus: 900, business: 1700 };

async function lookupDiscountCode(code, plan) {
  try {
    const { data: discount, error } = await sbQuery(
      supabaseAdmin
        .from('discount_codes')
        .select('*')
        .eq('code', String(code).trim().toUpperCase())
        .eq('is_active', true)
        .maybeSingle()
    );
    if (error || !discount) return null;

    const now = new Date();
    if (discount.valid_from && new Date(discount.valid_from) > now) return null;
    if (discount.valid_until && new Date(discount.valid_until) < now) return null;
    if (discount.max_uses !== null && discount.uses_count >= discount.max_uses) return null;
    if (discount.applies_to.length > 0 && !discount.applies_to.includes(plan)) return null;

    return discount;
  } catch {
    return null;
  }
}

function applyDiscountPhp(originalPhp, discount) {
  if (!discount) return originalPhp;
  if (discount.discount_type === 'percent') {
    return Math.max(0, Math.round(originalPhp * (1 - discount.discount_value / 100)));
  }
  return Math.max(0, originalPhp - discount.discount_value);
}

// POST /billing/validate-discount-code — validates a code without applying it
app.post('/billing/validate-discount-code', authMiddleware, async (req, res) => {
  const { code, plan } = req.body || {};
  if (!code || !plan) return res.status(400).json({ valid: false, error: 'missing_params' });

  const discount = await lookupDiscountCode(code, plan);
  if (!discount) {
    // Provide a specific error by re-checking without plan filter
    try {
      const { data: raw } = await sbQuery(
        supabaseAdmin.from('discount_codes').select('*').eq('code', String(code).trim().toUpperCase()).maybeSingle()
      );
      if (!raw) return res.json({ valid: false, error: 'Code not found' });
      const now = new Date();
      if (raw.valid_until && new Date(raw.valid_until) < now) return res.json({ valid: false, error: 'Code has expired' });
      if (!raw.is_active) return res.json({ valid: false, error: 'Code is no longer active' });
      if (raw.max_uses !== null && raw.uses_count >= raw.max_uses) return res.json({ valid: false, error: 'Code limit reached' });
      if (raw.applies_to.length > 0 && !raw.applies_to.includes(plan)) return res.json({ valid: false, error: 'Code is not valid for this plan' });
      return res.json({ valid: false, error: 'Code is not valid' });
    } catch {
      return res.json({ valid: false, error: 'Code not found' });
    }
  }

  const originalAmountPhp = DISCOUNT_PHP_AMOUNTS[plan] ?? 0;
  const discountedAmountPhp = applyDiscountPhp(originalAmountPhp, discount);

  return res.json({
    valid: true,
    codeId: discount.id,
    discountType: discount.discount_type,
    discountValue: discount.discount_value,
    originalAmountPhp,
    discountedAmountPhp,
    savingsPhp: originalAmountPhp - discountedAmountPhp,
    stripeCouponId: discount.stripe_coupon_id || null,
  });
});

/** ====== Billing (Stripe) ====== */
app.post('/billing/create-checkout-session', authMiddleware, async (req, res) => {
  try {
    if (!stripe) return res.status(501).json({ error: 'stripe_not_configured' });

    const { plan, discountCode } = req.body || {};
    const price =
      plan === 'yearly'
        ? STRIPE_PRICE_YEARLY
        : plan === 'monthly'
          ? STRIPE_PRICE_MONTHLY
          : null;

    if (!price) return res.status(400).json({ error: 'unknown_plan_or_price_not_set' });

    let subRow = get(`SELECT * FROM subscriptions WHERE user_id = ?`, [req.user.id]);

    if (!subRow) {
      run(`INSERT INTO subscriptions (id, user_id) VALUES (?, ?)`, [nanoid(), req.user.id]);
      subRow = get(`SELECT * FROM subscriptions WHERE user_id = ?`, [req.user.id]);
    }

    let customerId = subRow.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: { userId: req.user.id },
      });

      customerId = customer.id;

      run(`UPDATE subscriptions SET stripe_customer_id = ? WHERE id = ?`, [
        customerId,
        subRow.id,
      ]);
    }

    // Resolve optional discount code → Stripe coupon
    let stripeDiscounts;
    if (discountCode) {
      const discount = await lookupDiscountCode(discountCode, plan);
      if (discount?.stripe_coupon_id) {
        stripeDiscounts = [{ coupon: discount.stripe_coupon_id }];
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      success_url: BILLING_SUCCESS_URL || 'https://app.studiophotuna.com?billing=success',
      cancel_url: BILLING_CANCEL_URL || 'https://app.studiophotuna.com?billing=cancelled',
      // When we pass a pre-validated coupon, disable the manual promo code field (they conflict).
      // Without a code, keep the native promo code entry available on the hosted page.
      ...(stripeDiscounts ? { discounts: stripeDiscounts } : { allow_promotion_codes: true }),
      metadata: {
        userId: req.user.id,
        plan,
      },
      subscription_data: {
        metadata: {
          userId: req.user.id,
          plan,
        },
      },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error', err);
    return res.status(500).json({ error: err.message || 'server_error' });
  }
});

app.post('/billing/create-gallery-addon-session', authMiddleware, async (req, res) => {
  try {
    if (!stripe) return res.status(501).json({ error: 'stripe_not_configured' });
    if (!STRIPE_PRICE_GALLERY_ADDON_MONTHLY) {
      return res.status(400).json({ error: 'gallery_addon_price_not_set' });
    }

    let subRow = get(`SELECT * FROM subscriptions WHERE user_id = ?`, [req.user.id]);
    if (!subRow) {
      run(`INSERT INTO subscriptions (id, user_id) VALUES (?, ?)`, [nanoid(), req.user.id]);
      subRow = get(`SELECT * FROM subscriptions WHERE user_id = ?`, [req.user.id]);
    }

    let customerId = subRow.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: { userId: req.user.id },
      });
      customerId = customer.id;
      run(`UPDATE subscriptions SET stripe_customer_id = ? WHERE id = ?`, [customerId, subRow.id]);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: STRIPE_PRICE_GALLERY_ADDON_MONTHLY, quantity: 1 }],
      success_url: BILLING_SUCCESS_URL || 'https://app.studiophotuna.com?billing=success',
      cancel_url: BILLING_CANCEL_URL || 'https://app.studiophotuna.com?billing=cancelled',
      allow_promotion_codes: true,
      metadata: {
        userId: req.user.id,
        addon: 'gallery',
      },
      subscription_data: {
        metadata: {
          userId: req.user.id,
          addon: 'gallery',
        },
      },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('create-gallery-addon-session error', err);
    return res.status(500).json({ error: err.message || 'server_error' });
  }
});

app.get('/billing/subscription', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  const sbRow = await getSupabaseLicense(userId);
  if (sbRow) {
    const internal = sbRowToInternal(sbRow);
    return res.json({
      plan: internal.plan,
      state: internal.state,
      expiresAt: internal.current_period_end || 0,
      entitlements: internal.entitlements,
    });
  }

  const lic = get(`SELECT * FROM licenses WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`, [userId]);
  if (!lic) {
    return res.json({ plan: 'free', state: 'active', expiresAt: 0, entitlements: planEntitlements('free') });
  }
  return res.json({
    plan: lic.plan,
    state: lic.state,
    expiresAt: lic.current_period_end || 0,
    entitlements: JSON.parse(lic.entitlements_json || '{}'),
  });
});

app.post('/billing/customer-portal', authMiddleware, async (req, res) => {
  try {
    if (!stripe) return res.status(501).json({ error: 'stripe_not_configured' });
    const subRow = get(`SELECT * FROM subscriptions WHERE user_id = ?`, [req.user.id]);
    if (!subRow?.stripe_customer_id) return res.status(400).json({ error: 'no_stripe_customer' });

    const portal = await stripe.billingPortal.sessions.create({
      customer: subRow.stripe_customer_id,
      return_url: BILLING_PORTAL_RETURN_URL || 'https://studiophotuna.com/account'
    });
    return res.json({ url: portal.url });
  } catch (err) {
    console.error('customer-portal error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});


// Called by the app after Stripe checkout redirects back (success URL).
// Pulls the live subscription from Stripe and writes it to Supabase + SQLite,
// bypassing any webhook delivery issues.
app.post('/billing/sync', authMiddleware, async (req, res) => {
  try {
    if (!stripe) return res.status(501).json({ error: 'stripe_not_configured' });

    const userId = req.user.id;
    let subRow = get(`SELECT * FROM subscriptions WHERE user_id = ?`, [userId]);
    let customerId = subRow?.stripe_customer_id;

    // Webhook may not have fired yet — look up the customer directly from Stripe by email.
    if (!customerId) {
      try {
        const customers = await stripe.customers.list({ email: req.user.email, limit: 1 });
        customerId = customers.data[0]?.id ?? null;
        if (customerId) {
          if (subRow) {
            run(`UPDATE subscriptions SET stripe_customer_id = ? WHERE id = ?`, [customerId, subRow.id]);
          } else {
            run(`INSERT INTO subscriptions (id, user_id, stripe_customer_id) VALUES (?,?,?)`, [nanoid(), userId, customerId]);
            subRow = get(`SELECT * FROM subscriptions WHERE user_id = ?`, [userId]);
          }
        }
      } catch (e) {
        console.warn('[billing/sync] Stripe customer lookup by email failed:', e.message);
      }
    }

    if (!customerId) {
      return res.json({ synced: false, reason: 'no_stripe_customer' });
    }

    // Fetch all non-canceled subscriptions for this customer
    const [activeSubs, trialing] = await Promise.all([
      stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 10 }),
      stripe.subscriptions.list({ customer: customerId, status: 'trialing', limit: 10 }),
    ]);

    // Retry up to 3 times (2 s apart) — Stripe can take a moment to mark the
    // subscription active after checkout, especially under load.
    let allSubs = [...activeSubs.data, ...trialing.data];
    let gallerySub = allSubs.find((item) => item.metadata?.addon === 'gallery') || null;
    let sub = allSubs.find((item) => item.metadata?.addon !== 'gallery') || null;
    if (!sub) {
      for (let attempt = 1; attempt <= 3 && !sub; attempt++) {
        await new Promise(r => setTimeout(r, 2000));
        const [retryActive, retryTrialing] = await Promise.all([
          stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 10 }),
          stripe.subscriptions.list({ customer: customerId, status: 'trialing', limit: 10 }),
        ]);
        allSubs = [...retryActive.data, ...retryTrialing.data];
        gallerySub = allSubs.find((item) => item.metadata?.addon === 'gallery') || gallerySub;
        sub = allSubs.find((item) => item.metadata?.addon !== 'gallery') || null;
        console.log(`[billing/sync] retry ${attempt}: sub=${sub?.id || 'none'}`);
      }
    }
    if (gallerySub) {
      await setSupabaseGalleryAddon(userId, true, {
        stripe_customer_id: customerId,
        stripe_gallery_subscription_id: gallerySub.id,
      });
    }
    if (!sub) {
      return res.json({
        synced: Boolean(gallerySub),
        reason: gallerySub ? 'gallery_addon_synced' : 'no_active_subscription',
      });
    }

    const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
    const plan = interval === 'year' ? 'yearly' : 'monthly';
    const entitlements = planEntitlements(plan);
    entitlements.galleryAddon = Boolean(gallerySub);
    entitlements.galleryEnabled = Boolean(gallerySub);
    const state = sub.status === 'trialing' ? 'trialing' : 'active';
    const expires = sub.current_period_end || 0;

    const sbResult = await upsertSupabaseLicense(userId, { plan, state, expires, entitlements });
    if (!sbResult.ok) {
      console.error('[billing/sync] Supabase write failed:', sbResult.error);
    }
    syncToSQLite(userId, { plan, state, current_period_end: expires, entitlements });

    // Re-read and return a fresh license JWT
    const licenseJWTExp = Math.min(
      expires || nowSec() + parseInt(LICENSE_MAX_OFFLINE_DAYS, 10) * DAY_S,
      nowSec() + parseInt(LICENSE_MAX_OFFLINE_DAYS, 10) * DAY_S
    );
    const signedLicense = signLicenseJWT({ userId, plan, entitlements, expSeconds: licenseJWTExp });

    return res.json({
      synced: true,
      synced_supabase: sbResult.ok,
      supabase_error: sbResult.ok ? undefined : sbResult.error,
      license: { plan, state, expiresAt: expires, entitlements },
      signedLicense,
      publicKey: LICENSE_PUBLIC_KEY || null,
    });
  } catch (err) {
    console.error('billing/sync error', err);
    return res.status(500).json({ error: err.message || 'server_error' });
  }
});

// Returns display prices for UI (keeps Stripe price IDs separate)
app.get('/billing/prices', (_req, res) => {
  // You can hardcode, read from server env, or pull from Stripe
  // For now, read server env or default:
  const monthlyDisplay = process.env.DISPLAY_PRICE_MONTHLY_USD || process.env.DISPLAY_PRICE_MONTHLY_PHP || '$30 / mo';
  const yearlyDisplay = process.env.DISPLAY_PRICE_YEARLY_USD || process.env.DISPLAY_PRICE_YEARLY_PHP || '$204 / yr';
  res.json({
    currency: process.env.DISPLAY_PRICE_CURRENCY || 'USD',
    monthly: { display: monthlyDisplay, amount: parseInt(process.env.DISPLAY_PRICE_MONTHLY_AMOUNT || '30', 10) },
    yearly: { display: yearlyDisplay, amount: parseInt(process.env.DISPLAY_PRICE_YEARLY_AMOUNT || '204', 10) },
    galleryAddon: {
      display: DISPLAY_PRICE_GALLERY_ADDON_PHP,
      amount: parseInt(process.env.DISPLAY_PRICE_GALLERY_ADDON_AMOUNT || '499', 10),
      configured: Boolean(STRIPE_PRICE_GALLERY_ADDON_MONTHLY),
    },
  });
});


/** ====== PayMongo Subscription Billing ====== */
const PAYMONGO_BASE = 'https://api.paymongo.com/v1';
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || null;
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || null;
const QRCode = require('qrcode');

// Plan amounts in PHP centavos (1 PHP = 100 centavos)
const PAYMONGO_PLAN_AMOUNTS = {
  monthly:  180000,   // ₱1,800
  yearly:   1140000,  // ₱11,400
  plus:     90000,    // ₱900 / mo
  business: 170000,   // ₱1,700 / mo
};

const PAYMONGO_PLAN_LABELS = {
  monthly:  'Photuna Pro — Monthly',
  yearly:   'Photuna Pro — Yearly',
  plus:     'Photuna Gallery Plus — Monthly',
  business: 'Photuna Gallery Business — Monthly',
};

function pmBasicAuth() {
  return 'Basic ' + Buffer.from((PAYMONGO_SECRET_KEY || '') + ':').toString('base64');
}

async function pmFetch(path, options = {}) {
  const res = await fetch(`${PAYMONGO_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: pmBasicAuth(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.errors?.[0]?.detail || body?.errors?.[0]?.code || `PayMongo error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

// POST /billing/create-paymongo-link — create a payment link + QR for a plan
app.post('/billing/create-paymongo-link', authMiddleware, async (req, res) => {
  try {
    if (!PAYMONGO_SECRET_KEY) return res.status(501).json({ error: 'paymongo_not_configured' });
    const { planType, plan, discountCode } = req.body || {};
    if (!PAYMONGO_PLAN_AMOUNTS[plan]) return res.status(400).json({ error: 'unknown_plan' });

    // Apply discount server-side — never trust the amount from the client
    let amount = PAYMONGO_PLAN_AMOUNTS[plan]; // centavos
    if (discountCode) {
      const discount = await lookupDiscountCode(discountCode, plan);
      if (discount) {
        const originalPhp = amount / 100;
        const discountedPhp = applyDiscountPhp(originalPhp, discount);
        amount = Math.max(100, Math.round(discountedPhp * 100)); // minimum ₱1 = 100 centavos
      }
    }

    const description = PAYMONGO_PLAN_LABELS[plan] || `Photuna — ${plan}`;
    const body = await pmFetch('/links', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          attributes: {
            amount,
            description,
            remarks: `userId:${req.user.id}|planType:${planType}|plan:${plan}`,
          },
        },
      }),
    });

    const linkId      = body?.data?.id;
    const checkoutUrl = body?.data?.attributes?.checkout_url;
    if (!linkId || !checkoutUrl) return res.status(500).json({ error: 'no_link_returned' });

    const qrDataUrl = await QRCode.toDataURL(checkoutUrl, { width: 300, margin: 2 }).catch(() => null);

    return res.json({ linkId, checkoutUrl, qrDataUrl });
  } catch (err) {
    console.error('create-paymongo-link error', err);
    return res.status(500).json({ error: err.message || 'server_error' });
  }
});

// GET /billing/paymongo-link-status — poll link and activate license if paid
app.get('/billing/paymongo-link-status', authMiddleware, async (req, res) => {
  try {
    if (!PAYMONGO_SECRET_KEY) return res.status(501).json({ error: 'paymongo_not_configured' });
    const { linkId, planType, plan } = req.query || {};
    if (!linkId || !plan) return res.status(400).json({ error: 'missing_params' });

    const body = await pmFetch(`/links/${linkId}`);
    const status = body?.data?.attributes?.status;

    if (status !== 'paid') return res.json({ paid: false, status });

    // Activate the license
    const userId = req.user.id;
    const daysMap = { monthly: 30, yearly: 365, plus: 30, business: 30 };
    const days = daysMap[plan] || 30;
    const expiresTs = Math.floor(Date.now() / 1000) + days * 86400;

    if (planType === 'gallery') {
      await setSupabaseGalleryAddon(userId, true, {
        galleryTier: plan === 'business' ? 'business' : 'plus',
        expiresAt: new Date(expiresTs * 1000).toISOString(),
      });
    } else {
      const ent = planEntitlements(plan);
      await upsertSupabaseLicense(userId, {
        plan,
        state: 'active',
        expires: expiresTs,
        entitlements: ent,
      });
    }

    return res.json({ paid: true, plan });
  } catch (err) {
    console.error('paymongo-link-status error', err);
    return res.status(500).json({ error: err.message || 'server_error' });
  }
});

/** ====== PayMongo Webhook ====== */
app.post('/webhooks/paymongo', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!PAYMONGO_WEBHOOK_SECRET) return res.status(501).send('paymongo_not_configured');

  // Verify signature — PayMongo signs with HMAC-SHA256 of rawBody using the webhook secret
  const crypto = require('crypto');
  const rawBody = req.body.toString('utf8');
  const signature = req.headers['paymongo-signature'] || '';
  // PayMongo signature format: "t=<timestamp>,te=<sig>,li=<sig>"
  const parts = Object.fromEntries(signature.split(',').map((p) => p.split('=')));
  const toSign = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', PAYMONGO_WEBHOOK_SECRET).update(toSign).digest('hex');
  if (parts.te !== expected && parts.li !== expected) {
    console.warn('[PayMongo webhook] signature mismatch');
    return res.status(400).send('invalid_signature');
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return res.status(400).send('bad_json'); }

  if (event?.data?.attributes?.type === 'link.payment.paid') {
    try {
      const remarks = event?.data?.attributes?.data?.attributes?.remarks || '';
      // remarks format: "userId:<id>|planType:<type>|plan:<plan>"
      const m = {
        userId:   (remarks.match(/userId:([^|]+)/) || [])[1],
        planType: (remarks.match(/planType:([^|]+)/) || [])[1],
        plan:     (remarks.match(/plan:([^|]+)/) || [])[1],
      };
      if (m.userId && m.plan) {
        const daysMap = { monthly: 30, yearly: 365, plus: 30, business: 30 };
        const days = daysMap[m.plan] || 30;
        const expiresTs = Math.floor(Date.now() / 1000) + days * 86400;
        if (m.planType === 'gallery') {
          await setSupabaseGalleryAddon(m.userId, true, {
            galleryTier: m.plan === 'business' ? 'business' : 'plus',
            expiresAt: new Date(expiresTs * 1000).toISOString(),
          });
        } else {
          const ent = planEntitlements(m.plan);
          await upsertSupabaseLicense(m.userId, {
            plan: m.plan, state: 'active', expires: expiresTs, entitlements: ent,
          });
        }
        console.log(`[PayMongo webhook] activated plan=${m.plan} for userId=${m.userId}`);
      }
    } catch (err) {
      console.error('[PayMongo webhook] activation error', err);
    }
  }

  return res.json({ received: true });
});

/** ====== Stripe Webhook (raw body) ====== */
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(501).send('stripe_not_configured');
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const handle = transaction(() => {
    switch (event.type) {
      case 'checkout.session.completed': {
        const sess = event.data.object;
        const customerId = sess.customer;
        const metaUserId = sess.metadata?.userId;
        const metaPlan = sess.metadata?.plan; // 'monthly' or 'yearly'
        const metaAddon = sess.metadata?.addon;
        const custEmail = sess.customer_details?.email?.toLowerCase();

        const user = metaUserId
          ? get(`SELECT * FROM users WHERE id = ?`, [metaUserId])
          : (custEmail ? get(`SELECT * FROM users WHERE email = ?`, [custEmail]) : null);

        if (customerId && user) {
          let sub = get(`SELECT * FROM subscriptions WHERE user_id = ?`, [user.id]);
          if (!sub) {
            run(`INSERT INTO subscriptions (id, user_id, stripe_customer_id) VALUES (?,?,?)`, [nanoid(), user.id, customerId]);
          } else {
            run(`UPDATE subscriptions SET stripe_customer_id = ? WHERE id = ?`, [customerId, sub.id]);
          }

          // Write the license immediately from checkout metadata so we don't
          // have to wait for customer.subscription.created to arrive.
          if (metaAddon === 'gallery') {
            setSupabaseGalleryAddon(user.id, true, {
              stripe_customer_id: customerId,
              stripe_gallery_subscription_id: sess.subscription || null,
            })
              .then(r => !r.ok && console.error('[webhook] gallery addon upsert failed:', r.error))
              .catch((e) => console.error('[webhook] gallery addon upsert exception:', e.message));
          } else if (metaPlan === 'monthly' || metaPlan === 'yearly') {
            const entitlements = planEntitlements(metaPlan);
            // expires=0 now; subscription.created/updated will set the correct period end
            upsertSupabaseLicense(user.id, { plan: metaPlan, state: 'active', expires: 0, entitlements })
              .then(r => !r.ok && console.error('[webhook] checkout.session.completed upsertSupabaseLicense failed:', r.error))
              .catch((e) => console.error('[webhook] checkout.session.completed upsertSupabaseLicense exception:', e.message));
            syncToSQLite(user.id, { plan: metaPlan, state: 'active', current_period_end: 0, entitlements });
          }
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = sub.customer;
        const status = sub.status; // active, past_due, canceled, unpaid, trialing
        const currentPeriodEnd = sub.current_period_end; // unix ts
        const stripeSubId = sub.id;

        // Find user by subscription record
        const row = get(`SELECT * FROM subscriptions WHERE stripe_customer_id = ?`, [customerId]);
        if (row) {
          if (sub.metadata?.addon === 'gallery') {
            const enabled = status === 'active' || status === 'trialing';
            setSupabaseGalleryAddon(row.user_id, enabled, {
              stripe_customer_id: customerId,
              stripe_gallery_subscription_id: stripeSubId,
            })
              .then(r => !r.ok && console.error('[webhook] gallery subscription upsert failed:', r.error))
              .catch((e) => console.error('[webhook] gallery subscription upsert exception:', e.message));
            break;
          }

          const userId = row.user_id
          run(`UPDATE subscriptions SET stripe_subscription_id = ?, status = ?, current_period_end = ?, plan = ? WHERE id = ?`, [
            stripeSubId, status, currentPeriodEnd, sub.items?.data?.[0]?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly', row.id
          ]);

          // Reflect to licenses table — Supabase first, SQLite as backup
          const plan = sub.items?.data?.[0]?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly';
          const entitlements = planEntitlements(plan);
          const state = status === 'active' || status === 'trialing' ? 'active'
            : (status === 'past_due' ? 'past_due'
              : (status === 'canceled' ? 'canceled' : 'expired'));

          const expires = currentPeriodEnd || 0;

          upsertSupabaseLicense(userId, { plan, state, expires, entitlements })
            .then(r => !r.ok && console.error('[webhook] subscription upsertSupabaseLicense failed:', r.error))
            .catch((e) => console.error('[webhook] subscription upsertSupabaseLicense exception:', e.message));
          syncToSQLite(userId, { plan, state, current_period_end: expires, entitlements });

        }
        break;
      }
      case 'invoice.paid': {
        const inv = event.data.object;
        const customerId = inv.customer;
        const subRow = get(`SELECT * FROM subscriptions WHERE stripe_customer_id = ?`, [customerId]);
        if (!subRow) break;

        const interval = inv.lines?.data?.[0]?.price?.recurring?.interval;
        const priceId = inv.lines?.data?.[0]?.price?.id;
        if (priceId && priceId === STRIPE_PRICE_GALLERY_ADDON_MONTHLY) break;
        if (!interval) break; // one-time charge, not a subscription invoice

        const plan = interval === 'year' ? 'yearly' : 'monthly';
        const entitlements = planEntitlements(plan);
        const currentPeriodEnd = inv.lines?.data?.[0]?.period?.end || 0;

        upsertSupabaseLicense(subRow.user_id, { plan, state: 'active', expires: currentPeriodEnd, entitlements })
          .then(r => !r.ok && console.error('[webhook] invoice.paid upsertSupabaseLicense failed:', r.error))
          .catch((e) => console.error('[webhook] invoice.paid upsertSupabaseLicense exception:', e.message));
        syncToSQLite(subRow.user_id, { plan, state: 'active', current_period_end: currentPeriodEnd, entitlements });
        break;
      }
      case 'invoice.payment_failed':
      default:
        break;
    }
  });

  try {
    handle();
  } catch (err) {
    console.error('Webhook DB handling error', err);
    return res.status(500).send('webhook_processing_failed');
  }

  return res.json({ received: true });
});

/** ====== Health ====== */
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Photuna Licensing API', ts: Date.now() });
});

app.get('/public/google-reviews', async (_req, res) => {
  try {
    const payload = await fetchGoogleReviews();
    const ttl = Math.max(60, Math.floor((parseInt(GOOGLE_REVIEWS_CACHE_TTL_MS, 10) || 3_600_000) / 1000));
    res.setHeader('Cache-Control', `public, max-age=${Math.min(ttl, 3600)}`);
    res.json(payload);
  } catch (err) {
    console.error('[google-reviews] failed:', err.message);
    res.status(502).json({
      configured: Boolean(GOOGLE_PLACES_API_KEY && GOOGLE_PLACE_ID),
      source: 'google-places',
      rating: null,
      userRatingCount: null,
      reviews: [],
      error: err.message || 'Unable to load Google reviews',
    });
  }
});

/** ====== Billing redirect landing pages ====== */
app.get('/', (req, res) => {
  const status = req.query.billing;
  if (status === 'success') {
    return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Successful</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc}
.card{text-align:center;padding:2rem 3rem;background:#fff;border-radius:1rem;box-shadow:0 4px 24px rgba(0,0,0,.08)}
h1{color:#16a34a;font-size:1.5rem;margin:0 0 .5rem}p{color:#64748b;margin:0}</style></head>
<body><div class="card"><h1>✓ Payment successful!</h1>
<p>Return to the StudioPhotuna app to activate your plan.</p></div></body></html>`);
  }
  if (status === 'cancelled') {
    return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Cancelled</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc}
.card{text-align:center;padding:2rem 3rem;background:#fff;border-radius:1rem;box-shadow:0 4px 24px rgba(0,0,0,.08)}
h1{color:#dc2626;font-size:1.5rem;margin:0 0 .5rem}p{color:#64748b;margin:0}</style></head>
<body><div class="card"><h1>Payment cancelled</h1>
<p>Return to the StudioPhotuna app to try again.</p></div></body></html>`);
  }
  res.json({ ok: true, service: 'Photuna Licensing API' });
});

/** ====== Debug (dev only) ====== */
if (NODE_ENV !== 'production') {
  app.get('/debug/supabase', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const sbLic = await getSupabaseLicense(userId);
    const { data: profile } = await supabaseAdmin.from('profiles').select('subscription_plan').eq('id', userId).maybeSingle();
    res.json({
      userId,
      supabase_license: sbLic,
      profile_subscription_plan: profile?.subscription_plan ?? null,
    });
  });
}

/** ====== Start ====== */
app.listen(PORT, () => {
  console.log(`Licensing API listening on http://localhost:${PORT}`);
});
