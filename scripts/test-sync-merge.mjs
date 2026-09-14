// Tests the cross-device merge in src/services/syncMerge.js.
//
//   node scripts/test-sync-merge.mjs
//
// The module is ES-module source inside src/, so it is copied to a temp .mjs
// file and imported from there.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, "..", "src", "services", "syncMerge.js");
const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sync-merge-")), "syncMerge.mjs");
fs.copyFileSync(source, copy);
const { mergeSync, stampLocalChanges, recordDeletion, reconcileRemoteMeta, emptyMeta, TOMBSTONE_TTL_MS } = await import(pathToFileURL(copy).href);

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (err) { results.push({ name, ok: false, error: err.message }); }
}

const DAY = 24 * 60 * 60 * 1000;
const ev = (id, over = {}) => ({ id, name: `Event ${id}`, settings: { countdown: 3 }, appliedTemplates: [], ...over });
const tpl = (id, over = {}) => ({ id, name: `Template ${id}`, slots: [{ x: 0 }], ...over });
const blank = () => ({ events: [], templates: [], frames: [], palettes: [], tones: [], settings: {}, appearance: {} });

// A device: its items plus sync metadata, advanced through stamp → merge → save.
function device(items = {}) {
  return { items: { ...blank(), ...items }, meta: emptyMeta() };
}
function sync(dev, cloud, now) {
  dev.meta = stampLocalChanges(dev.items, dev.meta, now);
  const merged = mergeSync(dev, cloud, now);
  dev.items = merged.items;
  dev.meta = merged.meta;
  return { items: structuredClone(merged.items), meta: structuredClone(merged.meta) };
}
const emptyCloud = () => ({ items: blank(), meta: null });

check("upgrading loses nothing: first sync keeps local items and adds cloud-only ones", () => {
  const laptop = device({ events: [ev("a", { name: "Laptop copy" })], templates: [tpl("t1")] });
  const cloud = { items: { ...blank(), events: [ev("a", { name: "Old cloud copy" }), ev("b")], templates: [tpl("t2")] }, meta: null };
  const out = sync(laptop, cloud, 1000);
  assert.deepEqual(out.items.events.map((e) => [e.id, e.name]), [["a", "Laptop copy"], ["b", "Event b"]]);
  assert.deepEqual(out.items.templates.map((t) => t.id), ["t1", "t2"]);
});

check("an edit on one device reaches the other", () => {
  const laptop = device({ events: [ev("a")] });
  const tablet = device({ events: [ev("a")] });
  let cloud = sync(laptop, emptyCloud(), 1000);
  cloud = sync(tablet, cloud, 1100);

  laptop.items.events[0] = ev("a", { name: "Renamed on laptop" });
  cloud = sync(laptop, cloud, 2000);
  sync(tablet, cloud, 2100);
  assert.equal(tablet.items.events[0].name, "Renamed on laptop");
});

check("a stale device can no longer undo a newer edit", () => {
  const laptop = device({ templates: [tpl("t1")] });
  const tablet = device({ templates: [tpl("t1")] });
  let cloud = sync(laptop, emptyCloud(), 1000);
  cloud = sync(tablet, cloud, 1100);

  laptop.items.templates[0] = tpl("t1", { name: "New name" });
  cloud = sync(laptop, cloud, 2000);
  // The tablet saves without having pulled — the old whole-array push behaviour.
  cloud = sync(tablet, cloud, 2500);
  assert.equal(cloud.items.templates[0].name, "New name");
  assert.equal(tablet.items.templates[0].name, "New name");
});

check("when both devices edit, the most recent edit wins on every device", () => {
  const laptop = device({ events: [ev("a")] });
  const tablet = device({ events: [ev("a")] });
  let cloud = sync(laptop, emptyCloud(), 1000);
  cloud = sync(tablet, cloud, 1000);
  laptop.items.events[0] = ev("a", { name: "Laptop edit at 2000" });
  tablet.items.events[0] = ev("a", { name: "Tablet edit at 3000" });
  laptop.meta = stampLocalChanges(laptop.items, laptop.meta, 2000);
  tablet.meta = stampLocalChanges(tablet.items, tablet.meta, 3000);
  cloud = sync(laptop, cloud, 3500);
  cloud = sync(tablet, cloud, 3600);
  sync(laptop, cloud, 3700);
  assert.equal(laptop.items.events[0].name, "Tablet edit at 3000");
  assert.equal(tablet.items.events[0].name, "Tablet edit at 3000");
});

check("a booth logging sessions does not overwrite an operator's edit, and no session is lost", () => {
  const laptop = device({ events: [ev("a")] });
  const booth = device({ events: [ev("a")] });
  let cloud = sync(laptop, emptyCloud(), 1000);
  cloud = sync(booth, cloud, 1000);

  laptop.items.events[0] = { ...laptop.items.events[0], name: "Operator renamed", sessions: [{ id: "s-laptop", createdAt: "2026-09-13T01:00:00Z" }] };
  booth.items.events[0] = { ...booth.items.events[0], sessions: [{ id: "s1", createdAt: "2026-09-13T02:00:00Z" }, { id: "s2", createdAt: "2026-09-13T03:00:00Z" }] };

  cloud = sync(laptop, cloud, 2000);
  cloud = sync(booth, cloud, 5000); // the booth syncs later, having only logged sessions
  sync(laptop, cloud, 6000);

  for (const d of [laptop, booth]) {
    assert.equal(d.items.events[0].name, "Operator renamed");
    assert.deepEqual(d.items.events[0].sessions.map((s) => s.id), ["s-laptop", "s1", "s2"]);
  }
});

check("session logs are combined without duplicates", () => {
  const a = device({ events: [ev("a", { sessions: [{ id: "s1", createdAt: "1" }, { id: "s2", createdAt: "2" }] })] });
  const cloud = { items: { ...blank(), events: [ev("a", { sessions: [{ id: "s2", createdAt: "2" }, { id: "s3", createdAt: "3" }] })] }, meta: null };
  const out = sync(a, cloud, 1000);
  assert.deepEqual(out.items.events[0].sessions.map((s) => s.id), ["s1", "s2", "s3"]);
});

check("older session history (analytics.sessionLog) is combined; counters stay local", () => {
  const booth = device({ events: [ev("a", { analytics: { sessionsToday: 4, sessionLog: [{ ts: "2026-09-01T01:00:00Z", status: "completed" }] } })] });
  const cloud = { items: { ...blank(), events: [ev("a", { analytics: { sessionsToday: 9, sessionLog: [
    { ts: "2026-09-01T01:00:00Z", status: "completed" },
    { ts: "2026-08-30T01:00:00Z", status: "completed" },
  ] } })] }, meta: null };
  const out = sync(booth, cloud, 1000);
  assert.deepEqual(out.items.events[0].analytics.sessionLog.map((s) => s.ts), ["2026-08-30T01:00:00Z", "2026-09-01T01:00:00Z"]);
  assert.equal(out.items.events[0].analytics.sessionsToday, 4, "this device's counter was replaced");
});

check("retake state stays on the device that owns it", () => {
  const booth = device({ events: [ev("a", { retakenIndices: [1, 2] })] });
  const cloud = { items: { ...blank(), events: [ev("a", { retakenIndices: [9] })] }, meta: null };
  const out = sync(booth, cloud, 1000);
  assert.deepEqual(out.items.events[0].retakenIndices, [1, 2]);
  const fresh = device();
  sync(fresh, out, 2000);
  assert.equal(fresh.items.events[0].retakenIndices, undefined, "retake state leaked to another device");
});

check("a deletion on one device removes the item everywhere", () => {
  const laptop = device({ templates: [tpl("t1"), tpl("t2")] });
  const tablet = device({ templates: [tpl("t1"), tpl("t2")] });
  let cloud = sync(laptop, emptyCloud(), 1000);
  cloud = sync(tablet, cloud, 1000);

  laptop.items.templates = laptop.items.templates.filter((t) => t.id !== "t2");
  laptop.meta = recordDeletion(laptop.meta, "templates", "t2", 2000);
  cloud = sync(laptop, cloud, 2000);
  // The tablet still has t2 locally and pushes it back — it must not come back.
  cloud = sync(tablet, cloud, 3000);
  sync(laptop, cloud, 3100);
  assert.deepEqual(tablet.items.templates.map((t) => t.id), ["t1"]);
  assert.deepEqual(laptop.items.templates.map((t) => t.id), ["t1"]);
  assert.deepEqual(cloud.items.templates.map((t) => t.id), ["t1"]);
});

check("an item edited again after being deleted survives", () => {
  const laptop = device({ templates: [tpl("t1")] });
  const tablet = device({ templates: [tpl("t1")] });
  let cloud = sync(laptop, emptyCloud(), 1000);
  cloud = sync(tablet, cloud, 1000);
  laptop.items.templates = [];
  laptop.meta = recordDeletion(laptop.meta, "templates", "t1", 2000);
  cloud = sync(laptop, cloud, 2000);
  tablet.items.templates = [tpl("t1", { name: "Edited after the delete" })];
  tablet.meta = stampLocalChanges(tablet.items, tablet.meta, 3000);
  cloud = sync(tablet, cloud, 3000);
  sync(laptop, cloud, 3100);
  assert.equal(laptop.items.templates[0]?.name, "Edited after the delete");
});

check("an empty list on a device never deletes anything", () => {
  const laptop = device({ events: [ev("a"), ev("b")], templates: [tpl("t1")] });
  let cloud = sync(laptop, emptyCloud(), 1000);
  const broken = device(); // failed to load its store, or a fresh install
  cloud = sync(broken, cloud, 2000);
  assert.deepEqual(cloud.items.events.map((e) => e.id), ["a", "b"]);
  assert.deepEqual(cloud.items.templates.map((t) => t.id), ["t1"]);
  assert.deepEqual(broken.items.events.map((e) => e.id), ["a", "b"]);
});

check("booth runtime writes do not make an event newer", () => {
  const meta = stampLocalChanges({ events: [ev("a")] }, emptyMeta(), 1000);
  const after = stampLocalChanges({ events: [ev("a", { sessions: [{ id: "s1" }], retakenIndices: [3], analytics: { sessionsToday: 1 } })] }, meta, 5000);
  assert.equal(after.slices.events.a.updatedAt, meta.slices.events.a.updatedAt);
  const edited = stampLocalChanges({ events: [ev("a", { name: "Changed" })] }, meta, 6000);
  assert.equal(edited.slices.events.a.updatedAt, 6000);
});

check("old deletion records are forgotten after 90 days", () => {
  const laptop = device({ templates: [] });
  laptop.meta = recordDeletion(stampLocalChanges(laptop.items, laptop.meta, 0), "templates", "t9", 1000);
  const out = mergeSync(laptop, emptyCloud(), 1000 + TOMBSTONE_TTL_MS + DAY);
  assert.equal(out.meta.tombstones.templates.t9, undefined);
});

check("settings and appearance: the most recent change wins", () => {
  const laptop = device({ settings: { language: "en" } });
  const tablet = device({ settings: { language: "en" } });
  let cloud = sync(laptop, emptyCloud(), 1000);
  cloud = sync(tablet, cloud, 1000);
  tablet.items.settings = { language: "tl" };
  cloud = sync(tablet, cloud, 2000);
  sync(laptop, cloud, 2100);
  assert.equal(laptop.items.settings.language, "tl");
});

check("syncing twice changes nothing more (idempotent)", () => {
  const laptop = device({ events: [ev("a", { sessions: [{ id: "s1", createdAt: "1" }] })], templates: [tpl("t1")] });
  const cloud = { items: { ...blank(), events: [ev("b")], templates: [tpl("t2")] }, meta: null };
  const once = sync(laptop, cloud, 1000);
  const twice = sync(laptop, once, 1000);
  assert.deepEqual(twice.items, once.items);
});

check("this device's item order is kept", () => {
  const laptop = device({ templates: [tpl("t3"), tpl("t1"), tpl("t2")] });
  const out = sync(laptop, { items: { ...blank(), templates: [tpl("t1"), tpl("t4")] }, meta: null }, 1000);
  assert.deepEqual(out.items.templates.map((t) => t.id), ["t3", "t1", "t2", "t4"]);
});

check("an edit saved by an older app version (no metadata) is not ignored", () => {
  const laptop = device({ events: [ev("a")] });
  let cloud = sync(laptop, emptyCloud(), 1000);
  // A 0.4.10 booth renames the event in the cloud and pushes its arrays, leaving sync_meta as it was.
  const oldVersionItems = { ...cloud.items, events: [ev("a", { name: "Renamed on an old booth" })] };
  const reconciled = reconcileRemoteMeta(oldVersionItems, cloud.meta, 5000);
  assert.equal(reconciled.slices.events.a.updatedAt, 5000);
  sync(laptop, { items: oldVersionItems, meta: reconciled }, 6000);
  assert.equal(laptop.items.events[0].name, "Renamed on an old booth");
});

check("large frame data (1.4 MB) hashes quickly", () => {
  const big = "data:image/png;base64," + "A".repeat(1_400_000);
  const started = Date.now();
  stampLocalChanges({ frames: Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, image: big })) }, emptyMeta(), 1000);
  const ms = Date.now() - started;
  assert.ok(ms < 1500, `took ${ms} ms`);
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.ok ? "" : `\n        ${r.error}`}`);
}
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
