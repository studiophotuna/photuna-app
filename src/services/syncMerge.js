// src/services/syncMerge.js
//
// Merges an operator's booth setups (events, templates, frames, palettes, plus
// settings and appearance) between a device and the cloud copy, so an edit on
// one device reaches the others instead of being overwritten by whichever device
// saved last.
//
// Pure and dependency-free on purpose: this is where data would be lost if the
// rules were wrong, so it is tested on its own (scripts/test-sync-merge.mjs).
//
// How it decides:
//   - Every item has a fingerprint and a last-changed time, kept in a separate
//     metadata map rather than on the item, so the dashboard's own saves can never
//     strip them. An item is "changed" only when its operator-edited content's
//     fingerprint changes.
//   - When both sides have an item, the one changed most recently wins. Equal or
//     unknown times keep this device's copy, which is exactly how sync behaved
//     before, so upgrading loses nothing.
//   - A running booth writes to events too: the session log, payment counters and
//     retake state. Those are not operator edits, so they never make an event
//     newer. Session logs are combined from both sides; the rest stay on the
//     device that wrote them.
//   - Deletions are recorded explicitly when the operator deletes something
//     (recordDeletion), never guessed from an item being absent — a device that
//     loaded an empty list by mistake must not erase everything everywhere.
//     A deletion removes the item unless it was changed again after being deleted.

// "tones" is the operator's tone library (custom tones and imported LUTs).
export const SLICES = ["events", "templates", "frames", "palettes", "tones"];
export const OBJECTS = ["settings", "appearance"];

// Written by a running booth, not by the operator.
const EVENT_RUNTIME_FIELDS = ["sessions", "retakenIndices", "analytics", "lastPayment"];

export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const META_VERSION = 1;

export function emptyMeta() {
  return {
    version: META_VERSION,
    initialized: false,
    slices: Object.fromEntries(SLICES.map((s) => [s, {}])),
    objects: {},
    tombstones: Object.fromEntries(SLICES.map((s) => [s, {}])),
  };
}

function normalizeMeta(meta) {
  const base = emptyMeta();
  if (!meta || typeof meta !== "object" || meta.version !== META_VERSION) return base;
  return {
    version: META_VERSION,
    initialized: Boolean(meta.initialized),
    slices: Object.fromEntries(SLICES.map((s) => [s, { ...(meta.slices?.[s] || {}) }])),
    objects: { ...(meta.objects || {}) },
    tombstones: Object.fromEntries(SLICES.map((s) => [s, { ...(meta.tombstones?.[s] || {}) }])),
  };
}

// JSON with sorted keys, so the same content always produces the same string.
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

// FNV-1a 32-bit. Not cryptographic — it only has to notice that content changed.
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function editableContent(slice, item) {
  if (slice !== "events" || !item || typeof item !== "object") return item;
  const copy = { ...item };
  for (const field of EVENT_RUNTIME_FIELDS) delete copy[field];
  return copy;
}

export function contentHash(slice, item) {
  return fnv1a(stableStringify(editableContent(slice, item)));
}

const idOf = (item) => (item && item.id !== undefined && item.id !== null ? String(item.id) : null);

/**
 * Record which of this device's items changed since the last sync. Call before
 * merging. Never records deletions — see recordDeletion.
 */
export function stampLocalChanges(local, meta, now) {
  const next = normalizeMeta(meta);
  const firstRun = !next.initialized;

  for (const slice of SLICES) {
    for (const item of Array.isArray(local?.[slice]) ? local[slice] : []) {
      const id = idOf(item);
      if (!id) continue;
      const hash = contentHash(slice, item);
      const known = next.slices[slice][id];
      if (!known) {
        // Items that existed before sync metadata did get time 0, so any real
        // edit elsewhere outranks them and ties keep this device's copy.
        next.slices[slice][id] = { hash, updatedAt: firstRun ? 0 : now };
      } else if (known.hash !== hash) {
        next.slices[slice][id] = { hash, updatedAt: now };
      }
    }
  }

  for (const key of OBJECTS) {
    const value = local?.[key];
    if (!value || typeof value !== "object" || Object.keys(value).length === 0) continue;
    const hash = fnv1a(stableStringify(value));
    const known = next.objects[key];
    if (!known) next.objects[key] = { hash, updatedAt: firstRun ? 0 : now };
    else if (known.hash !== hash) next.objects[key] = { hash, updatedAt: now };
  }

  next.initialized = true;
  return next;
}

/**
 * Booths on app versions before this sync push their whole arrays without
 * touching the metadata, so a cloud item can change while its recorded
 * fingerprint stays the same. Left alone, the merge would treat that edit as old
 * and discard it. Where an item's content no longer matches its fingerprint,
 * credit the change to the time the cloud row was last written.
 */
export function reconcileRemoteMeta(items, meta, rowUpdatedAtMs) {
  const next = normalizeMeta(meta);
  const at = Number.isFinite(rowUpdatedAtMs) ? rowUpdatedAtMs : 0;

  for (const slice of SLICES) {
    for (const item of Array.isArray(items?.[slice]) ? items[slice] : []) {
      const id = idOf(item);
      if (!id) continue;
      const hash = contentHash(slice, item);
      const known = next.slices[slice][id];
      if (known && known.hash !== hash) {
        next.slices[slice][id] = { hash, updatedAt: Math.max(known.updatedAt || 0, at) };
      }
    }
  }

  for (const key of OBJECTS) {
    const value = items?.[key];
    const known = next.objects[key];
    if (!known || !value || typeof value !== "object") continue;
    const hash = fnv1a(stableStringify(value));
    if (known.hash !== hash) next.objects[key] = { hash, updatedAt: Math.max(known.updatedAt || 0, at) };
  }

  return next;
}

/** The operator deleted an item on this device. */
export function recordDeletion(meta, slice, id, now) {
  const next = normalizeMeta(meta);
  if (!SLICES.includes(slice) || id === undefined || id === null) return next;
  const key = String(id);
  next.tombstones[slice][key] = Math.max(next.tombstones[slice][key] || 0, now);
  delete next.slices[slice][key];
  return next;
}

function mergeSessions(a, b) {
  const byKey = new Map();
  for (const session of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!session || typeof session !== "object") continue;
    const key = session.id !== undefined && session.id !== null ? `id:${session.id}` : `json:${stableStringify(session)}`;
    if (!byKey.has(key)) byKey.set(key, session);
  }
  return [...byKey.values()].sort((x, y) => String(x.createdAt || "").localeCompare(String(y.createdAt || "")));
}

function mergeEvent(localItem, remoteItem, remoteWins) {
  const winner = remoteWins ? remoteItem : localItem;
  const merged = { ...editableContent("events", winner) };

  const sessions = mergeSessions(localItem?.sessions, remoteItem?.sessions);
  if (sessions.length || localItem?.sessions || remoteItem?.sessions) merged.sessions = sessions;

  // Device-local state: keep this device's values, whichever side's setup won.
  for (const field of ["retakenIndices", "analytics", "lastPayment"]) {
    if (localItem && localItem[field] !== undefined) merged[field] = localItem[field];
    else if (!localItem && remoteItem && field !== "retakenIndices" && remoteItem[field] !== undefined) {
      merged[field] = remoteItem[field];
    }
  }

  // analytics.sessionLog is session history written by older versions and still
  // shown in the event view. Unlike the counters beside it, history from every
  // device belongs together, so combine it rather than keeping one device's.
  const localLog = localItem?.analytics?.sessionLog;
  const remoteLog = remoteItem?.analytics?.sessionLog;
  if (Array.isArray(localLog) || Array.isArray(remoteLog)) {
    const combined = new Map();
    for (const entry of [...(Array.isArray(localLog) ? localLog : []), ...(Array.isArray(remoteLog) ? remoteLog : [])]) {
      if (!entry || typeof entry !== "object") continue;
      const key = stableStringify(entry);
      if (!combined.has(key)) combined.set(key, entry);
    }
    const sessionLog = [...combined.values()].sort((x, y) => String(x.ts || "").localeCompare(String(y.ts || "")));
    merged.analytics = { ...(merged.analytics || {}), sessionLog };
  }

  return merged;
}

/**
 * Merge this device's state with the cloud's.
 *
 * @param local  { items: { events, templates, frames, palettes, settings, appearance }, meta }
 * @param remote the same shape; remote.meta may be null for data saved before sync metadata existed
 * @returns      { items, meta } to save on this device and push to the cloud
 */
export function mergeSync(local, remote, now) {
  const localMeta = normalizeMeta(local?.meta);
  const remoteMeta = normalizeMeta(remote?.meta);
  const localItems = local?.items || {};
  const remoteItems = remote?.items || {};

  const meta = emptyMeta();
  meta.initialized = localMeta.initialized || remoteMeta.initialized;
  const items = {};

  for (const slice of SLICES) {
    // Deletions from either side, newest wins; forget ones old enough to be moot.
    const tombstones = {};
    for (const source of [localMeta.tombstones[slice], remoteMeta.tombstones[slice]]) {
      for (const [id, deletedAt] of Object.entries(source)) {
        if (now - deletedAt > TOMBSTONE_TTL_MS) continue;
        tombstones[id] = Math.max(tombstones[id] || 0, deletedAt);
      }
    }

    const localList = Array.isArray(localItems[slice]) ? localItems[slice] : [];
    const remoteList = Array.isArray(remoteItems[slice]) ? remoteItems[slice] : [];
    const localById = new Map(localList.filter(idOf).map((item) => [idOf(item), item]));
    const remoteById = new Map(remoteList.filter(idOf).map((item) => [idOf(item), item]));

    // This device's order first, then anything new from the cloud in its order.
    const order = [...localById.keys()];
    for (const id of remoteById.keys()) if (!localById.has(id)) order.push(id);

    const out = [];
    for (const id of order) {
      const localItem = localById.get(id);
      const remoteItem = remoteById.get(id);
      const localEntry = localMeta.slices[slice][id];
      const remoteEntry = remoteMeta.slices[slice][id];
      const localAt = localEntry?.updatedAt ?? 0;
      const remoteAt = remoteEntry?.updatedAt ?? 0;
      const changedAt = Math.max(localItem ? localAt : 0, remoteItem ? remoteAt : 0);

      const deletedAt = tombstones[id];
      if (deletedAt !== undefined) {
        if (deletedAt >= changedAt) continue; // deleted after its last change
        delete tombstones[id];                // changed again after being deleted
      }

      if (localItem && remoteItem) {
        const remoteWins = remoteAt > localAt;
        const merged = slice === "events"
          ? mergeEvent(localItem, remoteItem, remoteWins)
          : (remoteWins ? remoteItem : localItem);
        out.push(merged);
        meta.slices[slice][id] = { hash: contentHash(slice, merged), updatedAt: Math.max(localAt, remoteAt) };
      } else if (localItem) {
        out.push(localItem);
        meta.slices[slice][id] = localEntry || { hash: contentHash(slice, localItem), updatedAt: 0 };
      } else {
        const incoming = slice === "events" ? mergeEvent(null, remoteItem, true) : remoteItem;
        out.push(incoming);
        meta.slices[slice][id] = remoteEntry || { hash: contentHash(slice, incoming), updatedAt: 0 };
      }
    }

    // Items without an id cannot be matched across devices; keep this device's.
    for (const item of localList) if (!idOf(item)) out.push(item);

    items[slice] = out;
    meta.tombstones[slice] = tombstones;
  }

  for (const key of OBJECTS) {
    const localValue = localItems[key];
    const remoteValue = remoteItems[key];
    const hasLocal = localValue && typeof localValue === "object" && Object.keys(localValue).length > 0;
    const hasRemote = remoteValue && typeof remoteValue === "object" && Object.keys(remoteValue).length > 0;
    const localAt = localMeta.objects[key]?.updatedAt ?? 0;
    const remoteAt = remoteMeta.objects[key]?.updatedAt ?? 0;

    if (hasLocal && hasRemote) {
      const remoteWins = remoteAt > localAt;
      items[key] = remoteWins ? remoteValue : localValue;
      meta.objects[key] = remoteWins ? remoteMeta.objects[key] : (localMeta.objects[key] || { hash: fnv1a(stableStringify(localValue)), updatedAt: 0 });
    } else if (hasLocal || hasRemote) {
      items[key] = hasLocal ? localValue : remoteValue;
      meta.objects[key] = (hasLocal ? localMeta.objects[key] : remoteMeta.objects[key])
        || { hash: fnv1a(stableStringify(items[key])), updatedAt: 0 };
    } else {
      items[key] = hasLocal ? localValue : (remoteValue ?? localValue);
    }
  }

  return { items, meta };
}
