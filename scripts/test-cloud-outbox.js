// Checks electron/services/cloudOutbox.js without Electron or a network.
//
//   node scripts/test-cloud-outbox.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCloudOutbox, permanentError, BACKOFF_MS, MAX_AGE_MS } = require("../electron/services/cloudOutbox");

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

function freshOutbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-outbox-test-"));
  let clock = 1_000_000;
  const outbox = createCloudOutbox({ baseDir: dir, now: () => clock });
  return {
    dir,
    outbox,
    tick: (ms) => { clock += ms; },
    reopen: () => createCloudOutbox({ baseDir: dir, now: () => clock }),
    filesText: () => fs.readdirSync(path.join(dir, "cloud-outbox"))
      .map((f) => fs.readFileSync(path.join(dir, "cloud-outbox", f), "utf8"))
      .join("\n"),
  };
}

const GUEST_EMAIL = "guest.person@example.com";
const emailJob = (over = {}) => ({
  id: "email-sess_1-1",
  kind: "email",
  userId: "user-a",
  payload: { slug: "sess_1", email: GUEST_EMAIL, eventName: "Wedding", language: "en" },
  ...over,
});
const consentJob = (over = {}) => ({
  id: "consent-sess_1",
  kind: "consent",
  userId: "user-a",
  payload: { sessionId: "sess_1", eventId: "event-1", consentVersion: "1.0" },
  ...over,
});

check("a new record is due immediately, so it is sent while the guest is still there", () => {
  const { outbox } = freshOutbox();
  assert.ok(outbox.enqueue(consentJob()).ok);
  assert.strictEqual(outbox.due("user-a").length, 1);
});

check("enqueuing the same id twice keeps one job (a double tap cannot send twice)", () => {
  const { outbox } = freshOutbox();
  outbox.enqueue(emailJob());
  const again = outbox.enqueue(emailJob());
  assert.ok(again.ok && again.duplicate);
  assert.strictEqual(outbox.list("user-a").length, 1);
});

check("another operator cannot take over an existing job id", () => {
  const { outbox } = freshOutbox();
  outbox.enqueue(emailJob());
  const res = outbox.enqueue(emailJob({ userId: "user-b" }));
  assert.strictEqual(res.ok, false);
});

check("unsafe ids, unknown kinds, missing operator and oversized payloads are refused", () => {
  const { outbox } = freshOutbox();
  assert.strictEqual(outbox.enqueue(consentJob({ id: "../../evil" })).ok, false);
  assert.strictEqual(outbox.enqueue(consentJob({ kind: "payment" })).ok, false);
  assert.strictEqual(outbox.enqueue(consentJob({ userId: "" })).ok, false);
  assert.strictEqual(outbox.enqueue(consentJob({ payload: { blob: "x".repeat(70 * 1024) } })).ok, false);
  assert.strictEqual(outbox.list("user-a").length, 0);
});

check("a retryable failure backs off 1, 2, 5, 10 then 30 minutes", () => {
  const { outbox, tick } = freshOutbox();
  outbox.enqueue(consentJob());
  for (let i = 0; i < BACKOFF_MS.length + 1; i++) {
    outbox.fail("consent-sess_1", new Error("fetch failed"));
    const wait = BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)];
    tick(wait - 1);
    assert.strictEqual(outbox.due("user-a").length, 0, `still waiting after attempt ${i + 1}`);
    tick(1);
    assert.strictEqual(outbox.due("user-a").length, 1, `due after attempt ${i + 1}`);
  }
});

check("wake() makes waiting jobs due at once when the connection returns", () => {
  const { outbox } = freshOutbox();
  outbox.enqueue(consentJob());
  outbox.fail("consent-sess_1", new Error("fetch failed"));
  assert.strictEqual(outbox.due("user-a").length, 0);
  outbox.wake("user-a");
  assert.strictEqual(outbox.due("user-a").length, 1);
});

check("a permanent failure stops retries and erases the guest's email address", () => {
  const { outbox, filesText, tick } = freshOutbox();
  outbox.enqueue(emailJob());
  outbox.fail("email-sess_1-1", permanentError("invalid_email (422)"));
  tick(24 * 60 * 60 * 1000);
  assert.strictEqual(outbox.due("user-a").length, 0);
  assert.strictEqual(outbox.status("user-a").permanentlyFailed, 1);
  assert.ok(!filesText().includes(GUEST_EMAIL), "email address still on disk");
});

check("an email that could not be sent within a week expires and its address is erased", () => {
  const { outbox, filesText, tick } = freshOutbox();
  outbox.enqueue(emailJob());
  tick(MAX_AGE_MS.email + 1);
  assert.strictEqual(outbox.due("user-a").length, 0);
  assert.strictEqual(outbox.status("user-a").byKind.email.failed, 1);
  assert.ok(!filesText().includes(GUEST_EMAIL), "email address still on disk");
});

check("consent and survey records never expire", () => {
  const { outbox, tick } = freshOutbox();
  outbox.enqueue(consentJob());
  tick(60 * 24 * 60 * 60 * 1000);
  assert.strictEqual(outbox.due("user-a").length, 1);
});

check("delivering a job removes it, address and all", () => {
  const { outbox, dir } = freshOutbox();
  outbox.enqueue(emailJob());
  outbox.complete("email-sess_1-1");
  assert.strictEqual(outbox.list("user-a").length, 0);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, "cloud-outbox")), []);
});

check("consent is sent before survey answers and emails", () => {
  const { outbox, tick } = freshOutbox();
  outbox.enqueue(emailJob());
  tick(10);
  outbox.enqueue({ id: "survey-sess_1", kind: "survey", userId: "user-a", payload: { sessionId: "sess_1", answers: [] } });
  tick(10);
  outbox.enqueue(consentJob());
  assert.deepStrictEqual(outbox.due("user-a").map((j) => j.kind), ["consent", "survey", "email"]);
});

check("each operator only sees and sends their own records", () => {
  const { outbox } = freshOutbox();
  outbox.enqueue(consentJob());
  outbox.enqueue(consentJob({ id: "consent-sess_2", userId: "user-b" }));
  assert.strictEqual(outbox.due("user-a").length, 1);
  assert.strictEqual(outbox.due("user-b").length, 1);
  assert.strictEqual(outbox.status("user-a").pending, 1);
});

check("jobs survive an app restart", () => {
  const { outbox, reopen } = freshOutbox();
  outbox.enqueue(consentJob());
  outbox.fail("consent-sess_1", new Error("fetch failed"));
  const again = reopen();
  const [job] = again.list("user-a");
  assert.strictEqual(job.attempts, 1);
  assert.strictEqual(job.payload.sessionId, "sess_1");
});

check("status counts pending and failed records per kind", () => {
  const { outbox } = freshOutbox();
  outbox.enqueue(consentJob());
  outbox.enqueue(emailJob());
  outbox.fail("email-sess_1-1", permanentError("forbidden (403)"));
  const s = outbox.status("user-a");
  assert.strictEqual(s.pending, 1);
  assert.strictEqual(s.permanentlyFailed, 1);
  assert.deepStrictEqual(s.byKind.consent, { pending: 1, failed: 0 });
  assert.deepStrictEqual(s.byKind.email, { pending: 0, failed: 1 });
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.error}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
