/**
 * Capacitor platform shim
 *
 * Polyfills the same API surface as the Electron preload bridge (window.electron)
 * so all existing React screens work unmodified on iPad.
 *
 * Strategy per method type:
 *   - Data storage  → @capacitor/preferences (NSUserDefaults, scoped by userId key)
 *   - Gallery data  → Supabase direct queries (same DB as Windows app)
 *   - Hardware IPC  → Stubs (camera Phase 2, printing Phase 3)
 *   - App updates   → No-ops (App Store manages updates on iOS)
 *   - Event emitters → No-ops returning unsubscribe functions
 */

import { Preferences } from '@capacitor/preferences';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { registerPlugin } from '@capacitor/core';
import { supabase } from '../services/supabase';
import { changePassword } from '../services/licensingApi';
import { uploadSessionImages } from '../services/uploadSessionImages';
import { saveGalleryRecord } from '../services/saveGalleryRecord';

// Native photo printer plugin (PhotoPrinterPlugin.swift)
// Falls back to a no-op object on web / Electron so the shim loads everywhere.
const PhotoPrinter = (() => {
  try {
    return registerPlugin('PhotoPrinter', {
      web: () => ({
        discoverPrinters: async () => ({ printers: [] }),
        printPhoto:       async () => ({ ok: false, error: 'Native printer plugin not available on this platform' }),
        getPrinterStatus: async () => ({ status: 'unavailable' }),
      }),
    });
  } catch {
    return {
      discoverPrinters: async () => ({ printers: [] }),
      printPhoto:       async () => ({ ok: false, error: 'Native printer plugin not available' }),
      getPrinterStatus: async () => ({ status: 'unavailable' }),
    };
  }
})();

const GALLERY_BASE = 'https://gallery.studiophotuna.com/gallery';
const GALLERY_ADMIN_BASE = 'https://gallery.studiophotuna.com/admin';

// ── Identity ────────────────────────────────────────────────────────────────

async function getUserId() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

// ── Preferences helpers ──────────────────────────────────────────────────────

function scopedKey(name, userId) {
  return userId ? `${name}:${userId}` : name;
}

async function prefGet(name, userId, fallback = null) {
  try {
    const { value } = await Preferences.get({ key: scopedKey(name, userId) });
    return value != null ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function prefSet(name, value, userId) {
  try {
    await Preferences.set({ key: scopedKey(name, userId), value: JSON.stringify(value) });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

async function prefRemove(name, userId) {
  try {
    await Preferences.remove({ key: scopedKey(name, userId) });
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

// ── Keychain helpers (iOS Keychain via SecureStoragePlugin) ──────────────────
// Used only for payment gateway secrets. On iOS these go to the Keychain
// (encrypted, excluded from iCloud backup by default). On web/Electron the
// plugin falls back gracefully to localStorage — in those environments the
// Electron keytar module handles secrets instead, so this path is iPad-only.

const SECURE_PAYMENT_KEYS = ['paymongo', 'xendit', 'paypal'];

async function secureGet(key, fallback = null) {
  try {
    const { value } = await SecureStoragePlugin.get({ key });
    return value != null ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function secureSet(key, value) {
  try {
    await SecureStoragePlugin.set({ key, value: JSON.stringify(value) });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

async function secureRemove(key) {
  try {
    await SecureStoragePlugin.remove({ key });
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

// One-time migration: move any payment keys previously stored in NSUserDefaults
// (Preferences) into the Keychain. Runs once on first launch after this update.
async function migratePaymentKeysToKeychain() {
  const MIGRATION_FLAG = 'paymentKeysMigratedToKeychainV1';
  try {
    const already = await prefGet(MIGRATION_FLAG, null, false);
    if (already) return;
    for (const key of SECURE_PAYMENT_KEYS) {
      const existing = await prefGet(key, null, null);
      if (existing) {
        await secureSet(key, existing);
        await prefRemove(key, null);
      }
    }
    await prefSet(MIGRATION_FLAG, true, null);
  } catch {
    // Non-fatal — old data stays in Preferences until next successful run
  }
}

// Run migration asynchronously on module load (non-blocking)
migratePaymentKeysToKeychain();

// ── Gallery tier helpers ─────────────────────────────────────────────────────

function normalizeGalleryTier(value) {
  if (value === true) return 'plus';
  if (value === false || value == null) return 'free';
  const s = String(value).toLowerCase();
  return ['free', 'plus', 'business'].includes(s) ? s : 'free';
}

function resolveGalleryTier(row = {}) {
  if (row.gallery_tier) return normalizeGalleryTier(row.gallery_tier);
  return row.gallery_addon ? 'plus' : 'free';
}

// ── Storage helpers ───────────────────────────────────────────────────────────

// Convert a data URL to a Blob
function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ── Camera helpers ───────────────────────────────────────────────────────────

function stripWindowsCameraId(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const s = { ...settings };
  delete s.selectedCameraId;
  delete s.selectedCameraDeviceId;
  return s;
}

// ── Appearance helpers ────────────────────────────────────────────────────────

// Upload an appearance asset (logo or background image) to Supabase Storage.
// Path starts with userId so the UPDATE RLS policy (first folder = auth.uid()) passes.
async function uploadAppearanceAsset(file, userId, slot) {
  const ext = (file.name || '').split('.').pop() || 'png';
  const path = `${userId}/appearance/${slot}.${ext}`;
  const { error } = await supabase.storage
    .from('studiophotuna')
    .upload(path, file, { contentType: file.type || 'image/png', upsert: true });
  if (error) throw new Error(error.message);
  const { data, error: signErr } = await supabase.storage
    .from('studiophotuna')
    .createSignedUrl(path, 365 * 24 * 60 * 60);
  if (signErr) throw new Error(signErr.message);
  return data?.signedUrl ?? null;
}

// ── Stubs ────────────────────────────────────────────────────────────────────

const noopUnsub = () => {};
const noop = async () => null;

// ── The shim object ──────────────────────────────────────────────────────────

export const capacitorShim = {

  // ── Identity helper (mirrors preload's secureStore:getIdentity) ────────────
  getIdentity: async () => {
    const userId = await getUserId();
    return { userId };
  },

  // ── Events ─────────────────────────────────────────────────────────────────
  getEvents: async (ctx) => prefGet('events', ctx?.userId ?? await getUserId(), []),
  setEvents: async (events, ctx) => prefSet('events', events, ctx?.userId ?? await getUserId()),
  loadEvents: async (ctx) => prefGet('events', ctx?.userId ?? await getUserId(), []),
  cleanupEventStorage: noop,

  // ── Settings ───────────────────────────────────────────────────────────────
  getSettings: async (ctx) => {
    const s = await prefGet('settings', ctx?.userId ?? await getUserId(), {});
    return stripWindowsCameraId(s);
  },
  setSettings: async (settings, ctx) => prefSet('settings', settings, ctx?.userId ?? await getUserId()),

  // ── Appearance ─────────────────────────────────────────────────────────────
  getAppearance: async (ctx) => prefGet('appearance', ctx?.userId ?? await getUserId(), {}),
  setAppearance: async (appearance, ctx) => prefSet('appearance', appearance, ctx?.userId ?? await getUserId()),

  // ── Templates ──────────────────────────────────────────────────────────────
  getTemplates: async (ctx) => {
    const templates = await prefGet('templates', ctx?.userId ?? await getUserId(), []);
    if (!Array.isArray(templates)) return templates;
    // Strip Windows file:// / C:\ thumbnail paths — they don't resolve on iPad;
    // TemplateScreen falls back to tpl.icon when thumbSrc is null.
    const webSafe = (v) => !v || v.startsWith('https://') || v.startsWith('http://') || v.startsWith('data:');
    return templates.map(t => ({ ...t, thumbSrc: webSafe(t?.thumbSrc) ? t.thumbSrc : null }));
  },
  setTemplates: async (templates, ctx) => prefSet('templates', templates, ctx?.userId ?? await getUserId()),

  // ── Frames ─────────────────────────────────────────────────────────────────
  getFrames: async (ctx) => prefGet('frames', ctx?.userId ?? await getUserId(), []),
  setFrames: async (frames, ctx) => prefSet('frames', frames, ctx?.userId ?? await getUserId()),

  // ── Palettes & Tones ───────────────────────────────────────────────────────
  getPalettes: async (ctx) => prefGet('palettes', ctx?.userId ?? await getUserId(), []),
  setPalettes: async (palettes, ctx) => prefSet('palettes', palettes, ctx?.userId ?? await getUserId()),
  getTones: async (ctx) => prefGet('tones', ctx?.userId ?? await getUserId(), []),
  setTones: async (tones, ctx) => prefSet('tones', tones, ctx?.userId ?? await getUserId()),

  // ── Navigation state ────────────────────────────────────────────────────────
  getCurrentEventId: () => prefGet('currentEventId', null, null),
  setCurrentEventId: (id) => prefSet('currentEventId', id, null),
  getActiveMain: () => prefGet('activeMain', null, null),
  setActiveMain: (tab) => prefSet('activeMain', tab, null),
  getCurrentSubTab: () => prefGet('currentSubTab', null, null),
  setCurrentSubTab: (tab) => prefSet('currentSubTab', tab, null),

  // ── Meta flags ─────────────────────────────────────────────────────────────
  getMetaFlag: async ({ key } = {}) => prefGet(`meta:${key}`, null, null),
  setMetaFlag: async ({ key, value } = {}) => prefSet(`meta:${key}`, value, null),

  // ── Account preferences ────────────────────────────────────────────────────
  getAccountPreferences: async () => {
    const userId = await getUserId();
    return prefGet('accountPreferences', userId, {});
  },
  saveAccountPreferences: async (prefs = {}) => {
    const userId = prefs?.userId ?? await getUserId();
    return prefSet('accountPreferences', prefs, userId);
  },
  changeAccountPassword: async ({ currentPassword, newPassword } = {}) => {
    return changePassword(currentPassword, newPassword);
  },

  // ── Payment keys (iOS Keychain via SecureStoragePlugin) ───────────────────
  // These were previously in NSUserDefaults (Preferences). migratePaymentKeysToKeychain()
  // above moves any existing values to the Keychain on first run.
  getPayMongoStatus: async () => {
    const keys = await secureGet('paymongo', null);
    return { configured: !!(keys?.secretKey), ...(keys ?? {}) };
  },
  savePayMongoKeys: async (payload) => secureSet('paymongo', payload),
  clearPayMongoKeys: async () => secureRemove('paymongo'),

  getXenditStatus: async () => {
    const keys = await secureGet('xendit', null);
    return { configured: !!(keys?.apiKey), ...(keys ?? {}) };
  },
  saveXenditKeys: async (payload) => secureSet('xendit', payload),
  clearXenditKeys: async () => secureRemove('xendit'),

  getPaypalStatus: async () => {
    const keys = await secureGet('paypal', null);
    return { configured: !!(keys?.clientId), ...(keys ?? {}) };
  },
  savePaypalKeys: async (payload) => secureSet('paypal', payload),
  clearPaypalKeys: async () => secureRemove('paypal'),

  // ── Gallery — Supabase direct ───────────────────────────────────────────────
  getEventGallerySessions: async ({ eventId } = {}) => {
    try {
      const { data, error } = await supabase
        .from('galleries')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (error) return { sessions: [], error: error.message };

      const sessions = (data ?? []).map(row => ({
        sessionId: row.session_id ?? null,
        slug: row.slug,
        qrUrl: `${GALLERY_BASE}/${row.slug}`,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      }));

      return { sessions };
    } catch (err) {
      return { sessions: [], error: err?.message };
    }
  },

  createEventGalleryQr: async ({ eventId } = {}) => {
    try {
      const userId = await getUserId();

      const { data: existing } = await supabase
        .from('galleries')
        .select('slug, expires_at')
        .eq('event_id', eventId)
        .is('session_id', null)
        .maybeSingle();

      if (existing?.slug) {
        return {
          ok: true,
          slug: existing.slug,
          qrUrl: `${GALLERY_BASE}/${existing.slug}`,
          expiresAt: existing.expires_at,
          isNew: false,
        };
      }

      // Read license to set gallery_tier so branding applies
      let galleryTier = 'free';
      if (userId) {
        const { data: lic } = await supabase
          .from('licenses')
          .select('gallery_tier, gallery_addon')
          .eq('user_id', userId)
          .maybeSingle();
        galleryTier = resolveGalleryTier(lic || {});
      }

      const slug = `evt-${String(eventId).replace(/-/g, '').slice(0, 12)}-${Date.now().toString(36)}`;
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

      const { error } = await supabase.from('galleries').insert({
        slug,
        event_id: eventId,
        session_id: null,
        owner_user_id: userId,
        final_url: null,
        expires_at: expiresAt,
        gallery_tier: galleryTier,
      });

      if (error) return { ok: false, error: error.message };
      return { ok: true, slug, qrUrl: `${GALLERY_BASE}/${slug}`, expiresAt, isNew: true };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },

  // Gallery create — upload composed image to Supabase Storage + create gallery record
  createOnlineGallery: async ({ composedImage, composedImageUrl, photos = [], sessionId, eventId } = {}) => {
    try {
      const finalSrc = composedImage || composedImageUrl;
      if (!finalSrc) return { ok: false, error: 'No composed image provided' };
      if (!eventId) return { ok: false, error: 'Missing eventId' };

      const sid = sessionId || `ipad-${Date.now().toString(36)}`;

      // Convert data URL / remote URL to blob
      const finalBlob = await fetch(finalSrc).then(r => r.blob());

      // Convert individual photo data URLs to blobs (best-effort, non-fatal)
      const photoBlobs = (await Promise.allSettled(
        (photos || []).filter(Boolean).map(p => fetch(p).then(r => r.blob()))
      )).flatMap(r => r.status === 'fulfilled' ? [r.value] : []);

      // Upload to the shared Supabase Storage bucket
      const { finalUrl, photoUrls } = await uploadSessionImages({
        eventId,
        sessionId: sid,
        finalBlob,
        photoBlobs,
      });

      // Deterministic slug: eventId prefix + session fragment + timestamp
      const slug = `${String(eventId).replace(/-/g, '').slice(0, 12)}-${String(sid).replace(/-/g, '').slice(0, 8)}-${Date.now().toString(36)}`;

      await saveGalleryRecord({ slug, eventId, sessionId: sid, finalUrl, photoUrls });

      const qrUrl = `https://gallery.studiophotuna.com/gallery/${slug}`;
      return { ok: true, slug, qrUrl, finalUrl };
    } catch (err) {
      return { ok: false, error: err?.message || 'Gallery upload failed' };
    }
  },

  // ── Event data ─────────────────────────────────────────────────────────────
  saveEventData: async (data = {}, ctx) => {
    try {
      const userId = ctx?.userId ?? await getUserId();
      const { error } = await supabase
        .from('events')
        .upsert({ ...data, user_id: userId });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },
  getEventData: async (eventId = 'default', ctx) => {
    try {
      const userId = ctx?.userId ?? await getUserId();
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .eq('user_id', userId)
        .single();
      if (error) return null;
      return data;
    } catch {
      return null;
    }
  },
  syncEvent: noop,

  // ── Template selection ─────────────────────────────────────────────────────
  getActiveTemplate: async (eventId = 'default', ctx) =>
    prefGet(`template:${eventId}`, ctx?.userId, null),
  saveTemplateSelection: async (payload = {}, ctx) => {
    return prefSet(`template:${payload?.eventId ?? 'default'}`, payload, ctx?.userId);
  },

  // ── Appearance assets ──────────────────────────────────────────────────────
  saveAppearanceLogoFromFile: async (file, eventId, userId) => {
    try {
      const uid = userId ?? await getUserId() ?? 'anon';
      const url = await uploadAppearanceAsset(file, uid, 'logo');
      return { ok: true, savedPath: url, fileUrl: url, relativeKey: `${uid}/appearance/logo` };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },
  saveAppearanceBackgroundFromFile: async (file, eventId, userId) => {
    try {
      const uid = userId ?? await getUserId() ?? 'anon';
      if (!file.type?.startsWith('image/')) return { ok: false, error: 'Video backgrounds must be set on Windows' };
      const url = await uploadAppearanceAsset(file, uid, 'background');
      return { ok: true, savedPath: url, fileUrl: url, relativeKey: `${uid}/appearance/background` };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },
  saveAppearanceBackgroundFromDataUrl: async (dataUrl, originalName = null, mime = null, eventId = null, userId = null) => {
    try {
      if (!dataUrl) return { ok: false, error: 'No data URL provided' };
      const uid = userId ?? await getUserId() ?? 'anon';
      const ext = (originalName || '').split('.').pop() || 'png';
      const blob = dataUrlToBlob(dataUrl);
      const path = `${uid}/appearance/background.${ext}`;
      const { error } = await supabase.storage
        .from('studiophotuna')
        .upload(path, blob, { contentType: mime || blob.type || 'image/png', upsert: true });
      if (error) return { ok: false, error: error.message };
      const { data: signedData, error: signErr } = await supabase.storage
        .from('studiophotuna')
        .createSignedUrl(path, 365 * 24 * 60 * 60);
      if (signErr) return { ok: false, error: signErr.message };
      const url = signedData?.signedUrl ?? null;
      return { ok: true, savedPath: url, fileUrl: url, relativeKey: path };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },
  saveTemplateThumbnail: async (dataUrl, filename, userId = null) => {
    try {
      if (!dataUrl) return { ok: false, savedPath: null };
      const uid = userId ?? await getUserId() ?? 'anon';
      const name = filename || `thumb-${Date.now()}.png`;
      const blob = dataUrlToBlob(dataUrl);
      const path = `${uid}/templates/${name}`;
      const { error } = await supabase.storage
        .from('studiophotuna')
        .upload(path, blob, { contentType: 'image/png', upsert: true });
      if (error) return { ok: false, savedPath: null };
      const { data: signedData, error: signErr } = await supabase.storage
        .from('studiophotuna')
        .createSignedUrl(path, 365 * 24 * 60 * 60);
      if (signErr) return { ok: false, savedPath: null };
      const url = signedData?.signedUrl ?? null;
      return { ok: true, savedPath: url };
    } catch {
      return { ok: false, savedPath: null };
    }
  },
  deleteAppearanceAsset: async () => ({ ok: true }),
  resolveAppearanceUrl: async ({ savedPath, relativeKey } = {}) => ({
    ok: true,
    url: savedPath ?? relativeKey ?? null,
  }),

  // ── Camera ────────────────────────────────────────────────────────────────
  // capturePhoto is used both as a persistence bridge (passes dataUrl) and as
  // a hardware trigger (no args). On iPad, camera capture goes through the web
  // media APIs in PhotoScreen; this only needs to ack data-URL payloads.
  capturePhoto: async ({ dataUrl } = {}) => ({ ok: true, dataUrl: dataUrl ?? null }),
  capturesList: async () => ({ items: [] }),
  getCapturedPhotos: async () => [],
  listCameras: async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      return videoDevices.map((d, i) => ({
        id: d.deviceId || `ipad-camera-${i}`,
        label: d.label || (i === 0 ? 'Back Camera' : i === 1 ? 'Front Camera' : `Camera ${i + 1}`),
      }));
    } catch {
      return [];
    }
  },
  getCameraCapabilities: async () => ({}),

  // ── Stripe (iOS Keychain via SecureStoragePlugin) ────────────────────────────
  getStripeStatus: async () => {
    const cfg = await secureGet('stripe', null);
    return {
      ok: true,
      configured: !!(cfg?.secretKey && cfg?.validated),
      publishableKeyPreview: cfg?.publishableKeyPreview ?? null,
      testMode: cfg?.testMode ?? false,
      validatedAt: cfg?.validatedAt ?? null,
    };
  },
  saveStripeKeys: async ({ publishableKey, secretKey } = {}) => {
    try {
      if (!publishableKey || !secretKey) return { ok: false, error: 'Both keys are required' };
      if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_')) {
        return { ok: false, error: 'Invalid Stripe secret key format' };
      }
      const testMode = secretKey.startsWith('sk_test_');
      const cfg = {
        secretKey,
        publishableKey,
        publishableKeyPreview: publishableKey.slice(0, 14) + '...',
        validated: true,
        testMode,
        validatedAt: new Date().toISOString(),
      };
      return secureSet('stripe', cfg);
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },
  clearStripeKeys: async () => secureRemove('stripe'),

  // ── Gallery admin ─────────────────────────────────────────────────────────────
  openGalleryAdmin: async ({ eventId } = {}) => {
    try {
      let url = GALLERY_ADMIN_BASE;
      if (eventId) {
        const { data } = await supabase
          .from('galleries')
          .select('slug')
          .eq('event_id', eventId)
          .is('session_id', null)
          .maybeSingle();
        url = data?.slug
          ? `${GALLERY_ADMIN_BASE}/gallery/${data.slug}`
          : `${GALLERY_ADMIN_BASE}/event/${eventId}`;
      }
      window.open(url, '_blank');
      return { ok: true };
    } catch {
      window.open(GALLERY_ADMIN_BASE, '_blank');
      return { ok: true };
    }
  },

  // ── Printing — native PhotoPrinterPlugin (DNP / HiTi via WiFi) ───────────
  // printPhoto expects: { imageBase64, printerId?, copies?, mediaType?, brand? }
  //   imageBase64 — full-quality JPEG or PNG encoded as base64 string
  //   printerId   — id from discoverPrinters; omit to use first available
  //   copies      — number of prints (default 1)
  //   mediaType   — "4x6" | "2x6" (default "4x6")
  //   brand       — "dnp" | "hiti" (default "dnp")
  printPhoto: async (opts = {}) => {
    try {
      return await PhotoPrinter.printPhoto(opts);
    } catch (err) {
      return { ok: false, error: err?.message ?? 'Print failed' };
    }
  },

  getPrinters: async () => {
    try {
      const { printers } = await PhotoPrinter.discoverPrinters();
      return printers ?? [];
    } catch {
      return [];
    }
  },

  listPrinters: async () => {
    try {
      const { printers } = await PhotoPrinter.discoverPrinters();
      return printers ?? [];
    } catch {
      return [];
    }
  },

  testPrint: async (opts = {}) => {
    try {
      return await PhotoPrinter.printPhoto({ ...opts, copies: 1 });
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },

  scanDnpPrinters: async () => {
    try {
      const { printers } = await PhotoPrinter.discoverPrinters();
      return (printers ?? []).filter(p => p.brand === 'dnp');
    } catch {
      return [];
    }
  },

  getPrinterStatus: async ({ printerId, brand } = {}) => {
    try {
      return await PhotoPrinter.getPrinterStatus({ printerId, brand });
    } catch (err) {
      return { status: 'error', error: err?.message };
    }
  },

  setDnpCutMode: noop,
  detectCardTerminal: async () => ({ found: false }),

  // ── Payments ────────────────────────────────────────────────────────────────
  // Hardware-dependent flows (card terminal, cash drawer) are Windows-only.
  // QR gateway payments could work on iPad but require Phase 3 provider wiring.
  // recordPayment IS implemented: it updates local event analytics so cash
  // sessions are counted even without a physical payment terminal.
  finalizeCashPayment: async () => ({ ok: true }),
  startQrPayment: async () => ({ ok: false, error: 'QR payment requires a Windows booth with a payment provider configured.' }),
  startPayPalPayment: async () => ({ ok: false, error: 'PayPal payment requires a Windows booth.' }),
  startCardPayment: async () => ({ ok: false, error: 'Card payment requires a Windows booth with a card terminal.' }),
  startGatewayPayment: async () => ({ ok: false, error: 'QR gateway payment requires a Windows booth with PayMongo or Xendit configured.' }),
  chargeAdditionalPayment: async () => ({ ok: false }),
  cancelPayment: async () => ({ ok: true }),

  recordPayment: async (paymentRecord = {}) => {
    try {
      const userId = await getUserId();
      const events = await prefGet('events', userId, []);
      if (!Array.isArray(events) || !paymentRecord.eventId) return { ok: true };
      const updated = events.map(e => {
        if (String(e.id) !== String(paymentRecord.eventId)) return e;
        const analytics = { ...(e.analytics || {}) };
        const amt = Number(paymentRecord.amount) || 0;
        analytics.sessionsToday = (analytics.sessionsToday || 0) + 1;
        analytics.revenueToday = (analytics.revenueToday || 0) + amt;
        if (typeof analytics.sessionsWeekly === 'number') analytics.sessionsWeekly += 1;
        if (typeof analytics.revenueWeekly === 'number') analytics.revenueWeekly += amt;
        if (typeof analytics.sessionsMonthly === 'number') analytics.sessionsMonthly += 1;
        if (typeof analytics.revenueMonthly === 'number') analytics.revenueMonthly += amt;
        return { ...e, analytics, lastPayment: paymentRecord };
      });
      await prefSet('events', updated, userId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },

  // ── App control ────────────────────────────────────────────────────────────
  restartApp: async () => { window.location.reload(); },
  checkUpdates: async () => ({ updateAvailable: false }),
  downloadUpdate: noop,
  installUpdate: noop,
  clearCache: async () => { await Preferences.clear(); return { ok: true }; },
  getStorageInfo: async () => ({ available: true }),
  cleanupStorage: async () => ({ ok: true }),
  deleteStoredPhotos: async () => ({ ok: true }),

  // ── Preview server — no local Express on iPad; use in-memory session IDs ──
  previewStartServer: async () => ({ ok: true }),
  previewCreateSession: async () => {
    const sessionId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `ipad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    return { sessionId, token: null, previewUrl: null };
  },
  previewGetUrl: async () => null,
  // Stills/clips during capture are not streamed to a preview screen on iPad —
  // the gallery is built from the final composed image after the session.
  previewSaveStill: async () => ({ ok: true }),
  previewSaveSlotClip: async () => ({ ok: true }),
  getPreviewSlotClips: async () => [],
  buildFinalMotion: async () => ({ ok: false }),

  // Save the final composed PNG to Supabase Storage so it persists
  // Accepts both `dataUrl` and `imageData` (FrameFilterScreen uses imageData)
  saveFinalPng: async ({ dataUrl, imageData, eventId, sessionId } = {}) => {
    try {
      const src = dataUrl ?? imageData;
      if (!src || !eventId) return { ok: false, error: 'Missing dataUrl or eventId' };
      const sid = sessionId || `ipad-${Date.now().toString(36)}`;
      const blob = await fetch(src).then(r => r.blob());
      const path = `${eventId}/${sid}/final.png`;
      const { error } = await supabase.storage
        .from('studiophotuna')
        .upload(path, blob, { contentType: 'image/png', upsert: true });
      if (error) return { ok: false, error: error.message };
      const { data: signedData, error: signErr } = await supabase.storage
        .from('studiophotuna')
        .createSignedUrl(path, 365 * 24 * 60 * 60);
      if (signErr) return { ok: false, error: signErr.message };
      return { ok: true, fileUrl: signedData?.signedUrl ?? null };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },
  savePrintCopy: async () => ({ ok: true }),

  // eventHelpers.js calls safeElectron.ipcRenderer.invoke("sync-event" / "load-events").
  // Without this stub the missing property throws TypeError (caught silently but noisy).
  // Events on iPad persist via saveEventData / Supabase; these channels are no-ops here.
  ipcRenderer: {
    invoke: async (channel, ...args) => capacitorShim.invoke(channel, ...args),
  },

  // ── Event subscriptions (no IPC on iPad — return unsubscribe fn) ───────────
  onUpdaterStatus: () => noopUnsub,
  onEventsUpdated: () => noopUnsub,
  offEventsUpdated: noop,
  onPrintProgress: () => noopUnsub,
  onPaymentConfirmed: () => noopUnsub,
  onPaymentFailed: () => noopUnsub,
  on: () => noopUnsub,
  off: noop,
  removeListener: noop,
  triggerShutter: () => {},

  // ── Misc ───────────────────────────────────────────────────────────────────
  previewSuffix: () => `?_t=${Date.now()}`,

  // ── General invoke router ──────────────────────────────────────────────────
  // Handles the channels called via window.electron.invoke(channel, ...args)
  invoke: async (channel, ...args) => {
    switch (channel) {

      // Identity
      case 'secureStore:getIdentity': {
        const userId = await getUserId();
        return { userId };
      }

      // Settings via invoke (some screens use the invoke form)
      case 'store:getSettings': {
        const s = await prefGet('settings', args[0]?.userId, {});
        return stripWindowsCameraId(s);
      }
      case 'store:setSettings': {
        const [settings, ctx] = args;
        return prefSet('settings', settings, ctx?.userId);
      }

      // License — query Supabase directly (mirrors the Electron main-process IPC handler).
      // RLS policy "Users can view their own license" allows auth.uid() = user_id reads.
      case 'license:read': {
        const userId = args[0];
        if (!userId) return null;
        try {
          const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('license:read timed out')), 9000)
          );
          const { data, error } = await Promise.race([
            supabase.from('licenses').select('*').eq('user_id', userId).maybeSingle(),
            timeout,
          ]);
          if (error) {
            console.warn('[capacitorShim license:read]', error.message);
            return null;
          }
          // null row = confirmed free (no license record). Synthetic flag lets
          // LicenseContext evict a stale paid-plan cache instead of using it offline.
          return data ?? { plan: 'free', state: 'active', _synthetic: true };
        } catch (e) {
          console.warn('[capacitorShim license:read] failed:', e.message);
          return null;
        }
      }
      case 'license:cache-read': {
        const userId = args[0];
        return prefGet(`licenseCache:${userId}`, null, null);
      }
      case 'license:cache-write': {
        const [userId, data] = args;
        return prefSet(`licenseCache:${userId}`, data, null);
      }

      // App updates — iPad uses App Store
      case 'app:check-updates':
        return { updateAvailable: false };
      case 'app:download-update':
      case 'app:install-update':
      case 'app:restart':
      case 'app:clear-cache':
        return { ok: true };

      // Startup / storage — no-ops on iPad
      case 'startup:set':
      case 'storage:select':
      case 'storage:cleanup':
      case 'storage:delete-stored-photos':
      case 'log:export':
      case 'event:cleanupStorage':
        return { ok: true };

      // Storage info
      case 'storage:info':
        return { available: true };

      // Auth OAuth popup — open in Safari on iPad; Supabase handles the redirect
      case 'auth:oauth-popup': {
        const url = args[0];
        if (url) window.open(url, '_blank');
        return { ok: true };
      }

      // Meta flags via invoke form
      case 'store:getMetaFlag': {
        const { key } = args[0] ?? {};
        return prefGet(`meta:${key}`, null, null);
      }
      case 'store:setMetaFlag': {
        const { key, value } = args[0] ?? {};
        return prefSet(`meta:${key}`, value, null);
      }

      // Stripe
      case 'stripe:saveKeys': return capacitorShim.saveStripeKeys(args[0]);
      case 'stripe:getStatus': return capacitorShim.getStripeStatus();
      case 'stripe:clearKeys': return capacitorShim.clearStripeKeys();

      // Gallery admin
      case 'gallery:openAdmin': return capacitorShim.openGalleryAdmin(args[0]);

      // Health monitor — no persistent health state on iPad
      case 'health:status': return null;

      // Capabilities check — return empty on iPad
      case 'app:getCapabilities':
        return {};

      // Event file-sync (Electron-only; events persist via Supabase on iPad)
      case 'sync-event':
        return { success: true };
      case 'load-events':
        return { success: true, events: [] };

      default:
        console.warn('[capacitorShim] Unhandled invoke channel:', channel, args);
        return null;
    }
  },
};
