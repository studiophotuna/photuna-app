// electron/services/cloudOutbox.js
//
// Small records the booth owes the cloud — a guest's consent, their survey
// answers, a request to email them their gallery link — kept on disk until they
// are delivered, so a venue without internet delays them instead of losing them.
//
// One JSON file per job under userData/cloud-outbox/. As with galleryQueue,
// nothing here talks to the network: main sends each job, and the renderer
// supplies a fresh session token because only it can refresh one.
//
// Rules:
//   - The booth chooses each job's id and it never changes across retries, so a
//     repeat reaches the server as the same record: consent and survey rows are
//     unique per session, and an email send uses the id as its idempotency key.
//   - Retries back off (1, 2, 5, 10, then every 30 minutes); wake() makes waiting
//     jobs due at once when the connection comes back.
//   - A job that can never succeed is kept, marked permanent, and not retried.
//   - A guest's email address is personal data. It is erased from the job when
//     the job is delivered, fails for good, or grows too old to be worth sending.

const fs = require("fs");
const path = require("path");

const JOB_VERSION = 1;
const BACKOFF_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_\-]{0,119}$/;
const KINDS = ["consent", "survey", "email"];
const MAX_PAYLOAD_BYTES = 64 * 1024;
// A gallery link that arrives a week after the event is noise, and the address
// should not sit on a booth PC that long.
const MAX_AGE_MS = { email: 7 * 24 * 60 * 60 * 1000 };

/** An error that retrying cannot fix; the job is kept but no longer retried. */
function permanentError(message) {
  const err = new Error(message);
  err.permanent = true;
  return err;
}

function isPermanent(err) {
  return Boolean(err && err.permanent);
}

function scrubPersonalData(job) {
  if (job.kind === "email" && job.payload && job.payload.email) {
    job.payload = { ...job.payload, email: null };
  }
  return job;
}

function createCloudOutbox({ baseDir, now = () => Date.now() }) {
  const resolveBase = () => (typeof baseDir === "function" ? baseDir() : baseDir);
  const outboxDir = () => path.join(resolveBase(), "cloud-outbox");
  const jobFile = (id) => path.join(outboxDir(), `${id}.json`);

  function read(id) {
    if (!SAFE_ID.test(String(id))) return null;
    try {
      const job = JSON.parse(fs.readFileSync(jobFile(id), "utf8"));
      return job && job.version === JOB_VERSION ? job : null;
    } catch {
      return null;
    }
  }

  // Temp file + rename, so a power cut mid-write never leaves a torn job.
  function write(job) {
    fs.mkdirSync(outboxDir(), { recursive: true });
    const tmp = `${jobFile(job.id)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(job));
    fs.renameSync(tmp, jobFile(job.id));
    return job;
  }

  function all() {
    let names = [];
    try {
      names = fs.readdirSync(outboxDir());
    } catch {
      return [];
    }
    return names
      .filter((name) => name.endsWith(".json"))
      .map((name) => read(name.slice(0, -".json".length)))
      .filter(Boolean)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Keep a record until it is delivered. Enqueuing an id that already exists
   * returns the existing job, so a double tap cannot send twice.
   */
  function enqueue({ id, kind, userId, payload } = {}) {
    const jobId = String(id || "");
    if (!SAFE_ID.test(jobId)) return { ok: false, error: "invalid job id" };
    if (!KINDS.includes(kind)) return { ok: false, error: `unknown job kind: ${kind}` };
    if (!userId) return { ok: false, error: "userId required" };

    let body;
    try {
      body = JSON.stringify(payload ?? {});
    } catch {
      return { ok: false, error: "payload is not serialisable" };
    }
    if (Buffer.byteLength(body, "utf8") > MAX_PAYLOAD_BYTES) {
      return { ok: false, error: "payload too large" };
    }

    const existing = read(jobId);
    if (existing) {
      if (existing.userId !== String(userId) || existing.kind !== kind) {
        return { ok: false, error: "job id already in use" };
      }
      return { ok: true, job: existing, duplicate: true };
    }

    const job = write({
      version: JOB_VERSION,
      id: jobId,
      kind,
      userId: String(userId),
      createdAt: now(),
      attempts: 0,
      nextAttemptAt: now(),
      permanent: false,
      lastError: null,
      payload: JSON.parse(body),
    });
    return { ok: true, job };
  }

  function expireStale() {
    const t = now();
    for (const job of all()) {
      const maxAge = MAX_AGE_MS[job.kind];
      if (job.permanent || !maxAge || t - job.createdAt <= maxAge) continue;
      job.permanent = true;
      job.lastError = "expired before it could be sent";
      write(scrubPersonalData(job));
    }
  }

  function list(userId) {
    return all().filter((job) => job.userId === String(userId));
  }

  /** Jobs for this operator that are ready to send, consent first. */
  function due(userId) {
    expireStale();
    const t = now();
    const order = (kind) => KINDS.indexOf(kind);
    return list(userId)
      .filter((job) => !job.permanent && job.nextAttemptAt <= t)
      .sort((a, b) => order(a.kind) - order(b.kind) || a.createdAt - b.createdAt);
  }

  function complete(id) {
    if (!SAFE_ID.test(String(id))) return;
    fs.rmSync(jobFile(id), { force: true });
  }

  function fail(id, error) {
    const job = read(id);
    if (!job) return null;
    job.attempts += 1;
    job.lastError = String(error?.message || error || "").slice(0, 500);
    if (isPermanent(error)) {
      job.permanent = true;
      scrubPersonalData(job);
    } else {
      job.nextAttemptAt = now() + BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)];
    }
    return write(job);
  }

  /** The connection is back: make every waiting job for this operator due now. */
  function wake(userId) {
    const t = now();
    for (const job of list(userId)) {
      if (job.permanent || job.nextAttemptAt <= t) continue;
      job.nextAttemptAt = t;
      write(job);
    }
  }

  function status(userId) {
    const jobs = list(userId);
    const byKind = Object.fromEntries(KINDS.map((kind) => [kind, { pending: 0, failed: 0 }]));
    for (const job of jobs) {
      byKind[job.kind][job.permanent ? "failed" : "pending"] += 1;
    }
    const waiting = jobs.filter((job) => !job.permanent);
    return {
      pending: waiting.length,
      permanentlyFailed: jobs.length - waiting.length,
      oldestAt: waiting[0]?.createdAt ?? null,
      byKind,
    };
  }

  return { enqueue, due, list, complete, fail, wake, status };
}

module.exports = { createCloudOutbox, permanentError, isPermanent, BACKOFF_MS, KINDS, MAX_AGE_MS };
