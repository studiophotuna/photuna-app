// Tests the sync procedure in src/services/settingsSyncCore.js against a fake
// cloud that behaves like the real booth_settings row: updated_at changes on
// every write, and a conditional update fails if another device wrote first.
//
//   node scripts/test-settings-sync.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-sync-"));
fs.copyFileSync(path.join(here, "..", "src", "services", "syncMerge.js"), path.join(dir, "syncMerge.mjs"));
fs.writeFileSync(
  path.join(dir, "settingsSyncCore.mjs"),
  fs.readFileSync(path.join(here, "..", "src", "services", "settingsSyncCore.js"), "utf8").replace('from "./syncMerge.js"', 'from "./syncMerge.mjs"')
);
const { createSettingsSyncCore } = await import(pathToFileURL(path.join(dir, "settingsSyncCore.mjs")).href);

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (err) { results.push({ name, ok: false, error: err.message }); }
}

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function fakeCloud() {
  let row = null;
  let version = 0;
  const stamp = () => new Date(1_700_000_000_000 + (version += 1)).toISOString();
  const stats = { fetches: 0, updates: 0, inserts: 0, conflicts: 0 };
  let beforeUpdate = null;
  const cloud = {
    stats,
    get row() { return row; },
    set beforeUpdate(fn) { beforeUpdate = fn; },
    remote: {
      async fetch() {
        stats.fetches += 1;
        return { row: clone(row), error: null };
      },
      async update(_userId, expected, values) {
        if (beforeUpdate) { const fn = beforeUpdate; beforeUpdate = null; await fn(); }
        if (!row || row.updated_at !== expected) { stats.conflicts += 1; return { updated: false, error: null }; }
        stats.updates += 1;
        row = { ...row, ...clone(values), updated_at: stamp() };
        return { updated: true, error: null };
      },
      async insert(userId, values) {
        if (row) { stats.conflicts += 1; return { conflict: true, error: null }; }
        stats.inserts += 1;
        row = { user_id: userId, ...clone(values), updated_at: stamp() };
        return { inserted: true, error: null };
      },
    },
    // An app version before this sync: pushes whole arrays, never sends sync_meta.
    oldAppPush(values) {
      row = { ...row, ...clone(values), updated_at: stamp() };
    },
  };
  return cloud;
}

function fakeDevice(cloud, initial = {}, clock = { t: 1000 }) {
  const data = { events: [], templates: [], frames: [], palettes: [], tones: [], settings: {}, appearance: {}, ...clone(initial) };
  let meta = null;
  const store = {};
  for (const key of ["events", "templates", "frames", "palettes", "tones", "settings", "appearance"]) {
    const cap = key[0].toUpperCase() + key.slice(1);
    store[`get${cap}`] = async () => clone(data[key]);
    store[`set${cap}`] = async (v) => { data[key] = clone(v); };
  }
  const core = createSettingsSyncCore({
    store,
    remote: cloud.remote,
    metaStore: { load: () => clone(meta), save: (_u, m) => { meta = clone(m); } },
    now: () => clock.t,
  });
  core.init("user-1");
  return { core, data, clock, get meta() { return meta; } };
}

const ev = (id, over = {}) => ({ id, name: `Event ${id}`, settings: { countdown: 3 }, ...over });
const tpl = (id, over = {}) => ({ id, name: `Template ${id}`, ...over });

await check("first sync creates the cloud row; device-only fields stay off it", async () => {
  const cloud = fakeCloud();
  const laptop = fakeDevice(cloud, { events: [ev("a", { retakenIndices: [1], sessions: [{ id: "s1", createdAt: "1" }] })], settings: { language: "en" } });
  const r = await laptop.core.syncNow();
  assert.equal(r.ok, true);
  assert.equal(cloud.stats.inserts, 1);
  assert.equal(cloud.row.events[0].retakenIndices, undefined);
  assert.deepEqual(cloud.row.events[0].sessions.map((s) => s.id), ["s1"]);
  assert.ok(cloud.row.sync_meta);
});

await check("a sync with nothing new does not upload", async () => {
  const cloud = fakeCloud();
  const laptop = fakeDevice(cloud, { events: [ev("a")] });
  await laptop.core.syncNow();
  const writes = cloud.stats.updates + cloud.stats.inserts;
  const r = await laptop.core.syncNow();
  assert.equal(r.pushed, false);
  assert.equal(cloud.stats.updates + cloud.stats.inserts, writes);
});

await check("an edit on the laptop reaches the tablet", async () => {
  const cloud = fakeCloud();
  const clock = { t: 1000 };
  const laptop = fakeDevice(cloud, { events: [ev("a")] }, clock);
  const tablet = fakeDevice(cloud, { events: [ev("a")] }, clock);
  await laptop.core.syncNow();
  await tablet.core.syncNow();
  clock.t = 2000;
  laptop.data.events[0].name = "Renamed on laptop";
  await laptop.core.syncNow();
  clock.t = 2100;
  const r = await tablet.core.syncNow();
  assert.equal(tablet.data.events[0].name, "Renamed on laptop");
  assert.ok(r.changed.includes("events"));
});

await check("two booths with their own retake state do not wake each other forever", async () => {
  const cloud = fakeCloud();
  const clock = { t: 1000 };
  const a = fakeDevice(cloud, { events: [ev("a", { retakenIndices: [1] })] }, clock);
  const b = fakeDevice(cloud, { events: [ev("a", { retakenIndices: [7] })] }, clock);
  for (let i = 0; i < 3; i += 1) { await a.core.syncNow(); await b.core.syncNow(); }
  const writes = cloud.stats.updates;
  for (let i = 0; i < 4; i += 1) { await a.core.syncNow(); await b.core.syncNow(); }
  assert.equal(cloud.stats.updates, writes, "devices kept uploading with nothing to share");
  assert.deepEqual(a.data.events[0].retakenIndices, [1]);
  assert.deepEqual(b.data.events[0].retakenIndices, [7]);
});

await check("two devices saving at the same moment: the second retries and nothing is lost", async () => {
  const cloud = fakeCloud();
  const clock = { t: 1000 };
  const laptop = fakeDevice(cloud, { templates: [tpl("t1")] }, clock);
  const tablet = fakeDevice(cloud, { templates: [tpl("t1")] }, clock);
  await laptop.core.syncNow();
  await tablet.core.syncNow();

  clock.t = 2000;
  laptop.data.templates.push(tpl("t-laptop"));
  tablet.data.templates.push(tpl("t-tablet"));
  // The laptop's save lands after the tablet fetched but before it wrote.
  cloud.beforeUpdate = async () => { await laptop.core.syncNow(); };
  const r = await tablet.core.syncNow();
  assert.equal(r.ok, true);
  assert.ok(r.attempts >= 2, "tablet did not retry");
  await laptop.core.syncNow();
  const ids = (d) => d.data.templates.map((t) => t.id).sort();
  assert.deepEqual(ids(tablet), ["t-laptop", "t-tablet", "t1"]);
  assert.deepEqual(ids(laptop), ["t-laptop", "t-tablet", "t1"]);
  assert.deepEqual(cloud.row.templates.map((t) => t.id).sort(), ["t-laptop", "t-tablet", "t1"]);
});

await check("a deleted template stays deleted even though another device still has it", async () => {
  const cloud = fakeCloud();
  const clock = { t: 1000 };
  const laptop = fakeDevice(cloud, { templates: [tpl("t1"), tpl("t2")] }, clock);
  const tablet = fakeDevice(cloud, { templates: [tpl("t1"), tpl("t2")] }, clock);
  await laptop.core.syncNow();
  await tablet.core.syncNow();
  clock.t = 2000;
  laptop.core.recordDeletion("templates", "t2");
  laptop.data.templates = laptop.data.templates.filter((t) => t.id !== "t2");
  await laptop.core.syncNow();
  clock.t = 3000;
  await tablet.core.syncNow();
  await laptop.core.syncNow();
  assert.deepEqual(tablet.data.templates.map((t) => t.id), ["t1"]);
  assert.deepEqual(laptop.data.templates.map((t) => t.id), ["t1"]);
});

await check("an edit saved by a booth on an older app version is picked up", async () => {
  const cloud = fakeCloud();
  const clock = { t: 1000 };
  const laptop = fakeDevice(cloud, { events: [ev("a")] }, clock);
  await laptop.core.syncNow();
  clock.t = 5000;
  cloud.oldAppPush({ events: [ev("a", { name: "Renamed on a 0.4.10 booth" })] });
  await laptop.core.syncNow();
  assert.equal(laptop.data.events[0].name, "Renamed on a 0.4.10 booth");
});

await check("a device with an empty store never wipes the cloud", async () => {
  const cloud = fakeCloud();
  const laptop = fakeDevice(cloud, { events: [ev("a"), ev("b")], templates: [tpl("t1")] });
  await laptop.core.syncNow();
  const broken = fakeDevice(cloud, {});
  await broken.core.syncNow();
  assert.deepEqual(cloud.row.events.map((e) => e.id), ["a", "b"]);
  assert.deepEqual(broken.data.events.map((e) => e.id), ["a", "b"]);
});

await check("settings keep today's rules: this device wins, the cloud only seeds an empty one", async () => {
  const cloud = fakeCloud();
  const laptop = fakeDevice(cloud, { settings: { language: "tl" }, appearance: { logoPath: "https://cdn/logo.png", bgColor: "#111" } });
  await laptop.core.syncNow();
  const other = fakeDevice(cloud, { settings: { language: "en" }, appearance: { logoPath: "file:///C:/logo.png", bgColor: "#fff" } });
  await other.core.syncNow();
  assert.equal(other.data.settings.language, "en");
  assert.equal(other.data.appearance.bgColor, "#fff");
  assert.equal(other.data.appearance.logoPath, "https://cdn/logo.png", "cloud https logo should replace a local file path");
  const fresh = fakeDevice(cloud, {});
  await fresh.core.syncNow();
  assert.ok(fresh.data.settings.language, "a device with no settings was not seeded");
});

await check("a network failure reports an error instead of throwing, and keeps the record of the edit", async () => {
  const cloud = fakeCloud();
  const clock = { t: 1000 };
  const laptop = fakeDevice(cloud, { events: [ev("a")] }, clock);
  await laptop.core.syncNow();
  clock.t = 2000;
  laptop.data.events[0].name = "Edited offline";
  const realFetch = cloud.remote.fetch;
  cloud.remote.fetch = async () => ({ row: null, error: new Error("fetch failed") });
  const r = await laptop.core.syncNow();
  assert.equal(r.ok, false);
  assert.equal(laptop.meta.slices.events.a.updatedAt, 2000, "the edit's time was lost");
  cloud.remote.fetch = realFetch;
  await laptop.core.syncNow();
  assert.equal(cloud.row.events[0].name, "Edited offline");
});

await check("overlapping sync calls share one run", async () => {
  const cloud = fakeCloud();
  const laptop = fakeDevice(cloud, { events: [ev("a")] });
  const before = cloud.stats.fetches;
  const [x, y] = await Promise.all([laptop.core.syncNow(), laptop.core.syncNow()]);
  assert.equal(cloud.stats.fetches - before, 1);
  assert.deepEqual(x, y);
});

await check("booth session history from two booths ends up on both", async () => {
  const cloud = fakeCloud();
  const clock = { t: 1000 };
  const a = fakeDevice(cloud, { events: [ev("a")] }, clock);
  const b = fakeDevice(cloud, { events: [ev("a")] }, clock);
  await a.core.syncNow();
  await b.core.syncNow();
  a.data.events[0].sessions = [{ id: "a1", createdAt: "2026-09-13T01:00:00Z" }];
  b.data.events[0].sessions = [{ id: "b1", createdAt: "2026-09-13T02:00:00Z" }];
  await a.core.syncNow();
  await b.core.syncNow();
  await a.core.syncNow();
  assert.deepEqual(a.data.events[0].sessions.map((s) => s.id), ["a1", "b1"]);
  assert.deepEqual(b.data.events[0].sessions.map((s) => s.id), ["a1", "b1"]);
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.ok ? "" : `\n        ${r.error}`}`);
}
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
