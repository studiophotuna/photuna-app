import { supabase } from './supabase.js';

let _userId = null;
let _pendingTimer = null;

export function initSettingsSync(userId) {
  _userId = userId;
}

function getBridge() {
  if (typeof window === 'undefined') return null;
  return window.electron || window.api || null;
}

// Pull booth settings from Supabase → electron-store (call on app launch).
// Merge strategy (all slots use local-wins):
//   - Settings / Appearance: local always wins. Supabase is only used to seed
//     a fresh install (when local has no data at all). This prevents a stale
//     Supabase snapshot from wiping locally-saved business settings, provider
//     selections, or appearance changes that were made between the last push
//     and the current startup.
//   - Events: local always wins. New Supabase events (web app) are appended.
//   - Templates / Frames / Palettes: local always wins. New Supabase items are
//     merged in, but local creations are never overwritten even within the
//     2-second push debounce window.
//   - After merging, push the final local state back so Supabase stays in sync.
export async function pullSettings() {
  if (!_userId) return null;

  const { data, error } = await supabase
    .from('booth_settings')
    .select('*')
    .eq('user_id', _userId)
    .maybeSingle();

  if (error) {
    console.warn('[settingsSync] pull failed:', error.message);
    return null;
  }

  if (!data) return null;

  const store = getBridge();
  if (!store) return data;

  const ctx = { userId: _userId };
  const nonEmpty = (v) => v && typeof v === 'object' && Object.keys(v).length > 0;
  const hasItems = (v) => Array.isArray(v) && v.length > 0;

  // Read all local data in parallel first — local is the source of truth
  const [localSettings, localAppearance, localEvents, localTemplates, localFrames, localPalettes] =
    await Promise.all([
      store.getSettings?.(ctx),
      store.getAppearance?.(ctx),
      store.getEvents?.(ctx),
      store.getTemplates?.(ctx),
      store.getFrames?.(ctx),
      store.getPalettes?.(ctx),
    ]);

  // Settings: local always wins.
  if (!nonEmpty(localSettings) && nonEmpty(data.settings)) {
    await store.setSettings?.(data.settings, ctx);
  }

  // Appearance: merge so that HTTPS URLs from Supabase win over local file:// paths.
  // This lets cross-device logo/background uploads (stored as Supabase Storage URLs)
  // propagate to other devices that may have stale local file paths.
  if (nonEmpty(data.appearance)) {
    const isWebSafe = (v) => !v || v.startsWith('https://') || v.startsWith('http://') || v.startsWith('data:');
    if (!nonEmpty(localAppearance)) {
      // Fresh install — seed entirely from Supabase
      await store.setAppearance?.(data.appearance, ctx);
    } else {
      // Merge: keep local values except prefer Supabase HTTPS URLs for logo/background
      const merged = { ...localAppearance };
      if (!isWebSafe(localAppearance.logoPath) && isWebSafe(data.appearance.logoPath) && data.appearance.logoPath) {
        merged.logoPath = data.appearance.logoPath;
      }
      if (!isWebSafe(localAppearance.backgroundMediaPath) && isWebSafe(data.appearance.backgroundMediaPath) && data.appearance.backgroundMediaPath) {
        merged.backgroundMediaPath = data.appearance.backgroundMediaPath;
      }
      await store.setAppearance?.(merged, ctx);
    }
  }

  // Events: local always wins — the desktop is the authority for booth events.
  // Edits saved locally are preserved through a Ctrl+R even if the 2-second
  // push debounce hadn't fired yet. New events from Supabase (created on the
  // web app) are added to local, but existing local events are never overwritten.
  const localArr = Array.isArray(localEvents) ? localEvents : [];
  if (hasItems(data.events)) {
    const localById = new Map(localArr.map(le => [String(le.id), le]));
    const onlyInSupabase = data.events.filter(e => !localById.has(String(e.id)));
    if (onlyInSupabase.length > 0) {
      await store.setEvents?.([...localArr, ...onlyInSupabase], ctx);
    }
  }

  // Templates / Frames / Palettes: local always wins.
  // Only templates/frames/palettes that exist in Supabase but NOT locally are
  // merged in (same strategy as events). Local creations are never overwritten
  // by a Supabase pull, even if the 2-second push debounce hasn't fired yet.
  const localTplArr = Array.isArray(localTemplates) ? localTemplates : [];
  if (hasItems(data.templates)) {
    const localTplById = new Map(localTplArr.map(t => [String(t.id), t]));
    const onlyInSupabase = data.templates.filter(t => !localTplById.has(String(t.id)));
    if (onlyInSupabase.length > 0) {
      await store.setTemplates?.([...localTplArr, ...onlyInSupabase], ctx);
    }
  }

  const localFrameArr = Array.isArray(localFrames) ? localFrames : [];
  if (hasItems(data.frames)) {
    const localFrameById = new Map(localFrameArr.map(f => [String(f.id), f]));
    const onlyInSupabase = data.frames.filter(f => !localFrameById.has(String(f.id)));
    if (onlyInSupabase.length > 0) {
      await store.setFrames?.([...localFrameArr, ...onlyInSupabase], ctx);
    }
  }

  const localPaletteArr = Array.isArray(localPalettes) ? localPalettes : [];
  if (hasItems(data.palettes)) {
    const localPaletteById = new Map(localPaletteArr.map(p => [String(p.id), p]));
    const onlyInSupabase = data.palettes.filter(p => !localPaletteById.has(String(p.id)));
    if (onlyInSupabase.length > 0) {
      await store.setPalettes?.([...localPaletteArr, ...onlyInSupabase], ctx);
    }
  }

  // Upload local → Supabase so the cloud stays in sync with whatever is local.
  // Uses the 2-second debounce, so it's a no-op if a push is already queued.
  pushSettings({});

  console.log('[settingsSync] pulled from Supabase (local-first)');
  return data;
}

// Push electron-store → Supabase (debounced 2 s to batch rapid saves)
export function pushSettings(patch = {}) {
  if (!_userId) return;

  if (_pendingTimer) clearTimeout(_pendingTimer);

  _pendingTimer = setTimeout(async () => {
    const store = getBridge();
    const ctx = { userId: _userId };
    const payload = {
      user_id: _userId,
      settings: patch.settings ?? await store?.getSettings?.(ctx) ?? {},
      appearance: patch.appearance ?? await store?.getAppearance?.(ctx) ?? {},
      events: patch.events ?? await store?.getEvents?.(ctx) ?? [],
      templates: patch.templates ?? await store?.getTemplates?.(ctx) ?? [],
      frames: patch.frames ?? await store?.getFrames?.(ctx) ?? [],
      palettes: patch.palettes ?? await store?.getPalettes?.(ctx) ?? [],
      synced_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('booth_settings')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) {
      console.warn('[settingsSync] push failed:', error.message);
    } else {
      console.log('[settingsSync] pushed to Supabase');
    }
  }, 2000);
}

// Call when a specific slice changes (e.g. after store.setSettings)
export const pushSettingsSlice = (key, value) => pushSettings({ [key]: value });

// Immediate (non-debounced) push — use after explicit user deletions so the
// removal reaches Supabase before a page refresh wipes the pending debounce.
export async function pushSettingsNow(patch = {}) {
  if (!_userId) return;
  if (_pendingTimer) { clearTimeout(_pendingTimer); _pendingTimer = null; }
  const store = getBridge();
  const ctx = { userId: _userId };
  const payload = {
    user_id: _userId,
    settings:   patch.settings   ?? await store?.getSettings?.(ctx)   ?? {},
    appearance: patch.appearance ?? await store?.getAppearance?.(ctx) ?? {},
    events:     patch.events     ?? await store?.getEvents?.(ctx)     ?? [],
    templates:  patch.templates  ?? await store?.getTemplates?.(ctx)  ?? [],
    frames:     patch.frames     ?? await store?.getFrames?.(ctx)     ?? [],
    palettes:   patch.palettes   ?? await store?.getPalettes?.(ctx)   ?? [],
    synced_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('booth_settings')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) console.warn('[settingsSync] immediate push failed:', error.message);
  else console.log('[settingsSync] immediate push OK');
}
