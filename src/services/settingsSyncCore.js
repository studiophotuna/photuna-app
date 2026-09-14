// src/services/settingsSyncCore.js
//
// The sync procedure for booth setups, with storage and network passed in so it
// can be tested without Electron or Supabase (scripts/test-settings-sync.mjs).
// settingsSync.js wires it to the real store, localStorage and Supabase.
//
// One sync:
//   1. read this device's events/templates/frames/palettes/settings/appearance
//   2. record which items changed since last time (saved immediately, so a
//      network failure cannot lose the fact that something was edited)
//   3. fetch the cloud row and credit changes made by older app versions
//   4. merge (src/services/syncMerge.js)
//   5. write back only the lists that actually changed on this device
//   6. upload only if the result differs from the cloud — otherwise two devices
//      would keep waking each other forever
//   7. upload conditionally on the row being unchanged since step 3; if another
//      device wrote in between, start again from step 1 with its data
//
// Scope: events, templates, frames and palettes merge across devices. Settings and
// appearance keep their previous rules — this device's values win, the cloud only
// seeds a device that has none, and a cloud https logo/background replaces a local
// file path. The dashboard holds those in many separate form fields that it saves
// back from memory, so merging them underneath it would let the next unrelated
// edit silently revert another device's change.

import { SLICES, stampLocalChanges, reconcileRemoteMeta, mergeSync, stableStringify, recordDeletion } from "./syncMerge.js";

const MAX_ATTEMPTS = 3;

const SETTERS = { events: "setEvents", templates: "setTemplates", frames: "setFrames", palettes: "setPalettes", tones: "setTones" };

const asArray = (v) => (Array.isArray(v) ? v : []);
const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const isEmptyObject = (v) => Object.keys(asObject(v)).length === 0;
const isWebSafe = (v) => !v || /^(https?:|data:)/.test(String(v));

// Each device keeps its own retake progress and payment counters on its events.
// Uploading them would make every device's copy differ from the cloud on every
// sync, so they stay off the shared row. Session history is shared.
function eventForCloud(event) {
  if (!event || typeof event !== "object") return event;
  const copy = { ...event };
  delete copy.retakenIndices;
  delete copy.lastPayment;
  if (copy.analytics && typeof copy.analytics === "object") {
    copy.analytics = Array.isArray(copy.analytics.sessionLog) ? { sessionLog: copy.analytics.sessionLog } : undefined;
    if (copy.analytics === undefined) delete copy.analytics;
  }
  return copy;
}

function slicesOf(source) {
  return Object.fromEntries(SLICES.map((s) => [s, asArray(source?.[s])]));
}

export function createSettingsSyncCore({ store, remote, metaStore, now = () => Date.now(), log = () => {} }) {
  let userId = null;
  let inFlight = null;

  const ctx = () => ({ userId });

  async function readLocal() {
    const [events, templates, frames, palettes, tones, settings, appearance] = await Promise.all([
      store.getEvents?.(ctx()),
      store.getTemplates?.(ctx()),
      store.getFrames?.(ctx()),
      store.getPalettes?.(ctx()),
      store.getTones?.(ctx()),
      store.getSettings?.(ctx()),
      store.getAppearance?.(ctx()),
    ]);
    return {
      events: asArray(events),
      templates: asArray(templates),
      frames: asArray(frames),
      palettes: asArray(palettes),
      tones: asArray(tones),
      settings: asObject(settings),
      appearance: asObject(appearance),
    };
  }

  function resolveObjects(local, row) {
    const settings = isEmptyObject(local.settings) ? asObject(row?.settings) : local.settings;

    let appearance = local.appearance;
    const remoteAppearance = asObject(row?.appearance);
    if (isEmptyObject(appearance)) {
      appearance = remoteAppearance;
    } else if (!isEmptyObject(remoteAppearance)) {
      const merged = { ...appearance };
      for (const key of ["logoPath", "backgroundMediaPath"]) {
        if (!isWebSafe(appearance[key]) && remoteAppearance[key] && isWebSafe(remoteAppearance[key])) {
          merged[key] = remoteAppearance[key];
        }
      }
      appearance = merged;
    }
    return { settings, appearance };
  }

  async function attempt() {
    const local = await readLocal();

    const stamped = stampLocalChanges(slicesOf(local), metaStore.load(userId), now());
    metaStore.save(userId, stamped);

    const { row, error: fetchError } = await remote.fetch(userId);
    if (fetchError) return { ok: false, error: fetchError.message || String(fetchError), changed: [] };

    const remoteSlices = row ? slicesOf(row) : slicesOf(null);
    const remoteMeta = row ? reconcileRemoteMeta(remoteSlices, row.sync_meta, Date.parse(row.updated_at)) : null;
    const merged = mergeSync({ items: slicesOf(local), meta: stamped }, { items: remoteSlices, meta: remoteMeta }, now());
    const { settings, appearance } = resolveObjects(local, row);

    const changed = [];
    for (const slice of SLICES) {
      if (stableStringify(merged.items[slice]) !== stableStringify(local[slice])) {
        await store[SETTERS[slice]]?.(merged.items[slice], ctx());
        changed.push(slice);
      }
    }
    if (stableStringify(settings) !== stableStringify(local.settings)) {
      await store.setSettings?.(settings, ctx());
      changed.push("settings");
    }
    if (stableStringify(appearance) !== stableStringify(local.appearance)) {
      await store.setAppearance?.(appearance, ctx());
      changed.push("appearance");
    }
    metaStore.save(userId, merged.meta);

    const cloudValues = {
      events: merged.items.events.map(eventForCloud),
      templates: merged.items.templates,
      frames: merged.items.frames,
      palettes: merged.items.palettes,
      tones: merged.items.tones,
      settings,
      appearance,
      sync_meta: merged.meta,
    };

    if (row) {
      const current = {
        events: asArray(row.events).map(eventForCloud),
        templates: asArray(row.templates),
        frames: asArray(row.frames),
        palettes: asArray(row.palettes),
        tones: asArray(row.tones),
        settings: asObject(row.settings),
        appearance: asObject(row.appearance),
        sync_meta: row.sync_meta ?? null,
      };
      if (stableStringify(cloudValues) === stableStringify(current)) {
        return { ok: true, pushed: false, changed, items: merged.items };
      }
    }

    const payload = { ...cloudValues, synced_at: new Date(now()).toISOString() };

    if (row) {
      const result = await remote.update(userId, row.updated_at, payload);
      if (result.error) return { ok: false, error: result.error.message || String(result.error), changed };
      if (!result.updated) return { ok: false, conflict: true, changed };
    } else {
      const result = await remote.insert(userId, payload);
      if (result.conflict) return { ok: false, conflict: true, changed };
      if (result.error) return { ok: false, error: result.error.message || String(result.error), changed };
    }

    return { ok: true, pushed: true, changed, items: merged.items };
  }

  /** Run one sync. Concurrent callers share the one in progress. */
  function syncNow() {
    if (!userId) return Promise.resolve({ ok: false, error: "not initialised", changed: [] });
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const changedAll = new Set();
      try {
        for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
          const result = await attempt();
          result.changed.forEach((s) => changedAll.add(s));
          if (!result.conflict) return { ...result, changed: [...changedAll], attempts: i + 1 };
          log(`sync conflict with another device (attempt ${i + 1}), retrying`);
        }
        return { ok: false, conflict: true, error: "another device kept saving", changed: [...changedAll], attempts: MAX_ATTEMPTS };
      } catch (err) {
        log(`sync failed: ${err?.message || err}`);
        return { ok: false, error: err?.message || String(err), changed: [...changedAll] };
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  return {
    init(id) {
      userId = id ? String(id) : null;
    },
    syncNow,
    recordDeletion(slice, id) {
      if (!userId) return;
      metaStore.save(userId, recordDeletion(metaStore.load(userId), slice, id, now()));
    },
    get userId() {
      return userId;
    },
  };
}
