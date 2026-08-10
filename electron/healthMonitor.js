/**
 * healthMonitor.js — continuous background health checks for 24/7 booth operation.
 *
 * Checks every 5 minutes:
 *   - Main-process heap & RSS (memory leak detection)
 *   - Free disk space on the userData volume
 *   - Accumulated session folder count (disk-fill early warning)
 *   - App uptime
 *
 * Results are appended as JSON-lines to logs/health.log.
 * Errors (unhandled rejections, uncaught exceptions) go to logs/errors.log.
 * The latest snapshot is kept in memory so the /health endpoint can serve it instantly.
 */

const fs    = require("fs");
const path  = require("path");
const os    = require("os");

// Warn thresholds
const HEAP_WARN_MB  = 800;   // React + Electron baseline is ~150-250 MB; >800 suggests a leak
const RSS_WARN_MB   = 1500;
const DISK_WARN_GB  = 1.0;   // < 1 GB free is a real risk for a photo booth
const SESSION_WARN  = 1000;  // > 1 000 session folders — likely disk-fill risk

class HealthMonitor {
  constructor({ userDataDir, usersDir, logDir }) {
    this.userDataDir = userDataDir;
    this.usersDir    = usersDir;
    this.logDir      = logDir;
    this.healthLog   = path.join(logDir, "health.log");
    this.errorLog    = path.join(logDir, "errors.log");

    this._timer      = null;
    this._snapshot   = null;
    this._errorCount = 0;

    fs.mkdirSync(logDir, { recursive: true });
    this._pruneLogs();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  start(intervalMs = 5 * 60 * 1000) {
    // Run once immediately so the /health endpoint has data from the first request
    this._run();
    this._timer = setInterval(() => this._run(), intervalMs);
    this._timer.unref(); // don't prevent app from quitting
    return this;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  /** Returns the latest health snapshot synchronously (cached from last check). */
  getSnapshot() {
    return this._snapshot;
  }

  /** Append a structured error entry to errors.log. */
  logError(type, error) {
    this._errorCount++;
    const entry = {
      ts:      new Date().toISOString(),
      type,
      message: error?.message ?? String(error),
      stack:   error?.stack  ?? null,
    };
    fs.appendFile(this.errorLog, JSON.stringify(entry) + "\n", () => {});
    console.error(`[health] ${type}:`, error);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  async _run() {
    try {
      const snapshot = await this._collect();
      this._snapshot = snapshot;
      fs.appendFile(this.healthLog, JSON.stringify(snapshot) + "\n", () => {});
      this._emitWarnings(snapshot);
    } catch (err) {
      console.error("[health] check failed:", err.message);
    }
  }

  async _collect() {
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const rssMB  = Math.round(mem.rss      / 1024 / 1024);

    const disk    = await this._checkDisk();
    const sessions = await this._countSessions();

    return {
      ts:      new Date().toISOString(),
      ok:      !this._hasWarnings({ heapMB, rssMB, disk, sessions }),
      uptime:  { appSeconds: Math.round(process.uptime()), osSeconds: Math.round(os.uptime()) },
      memory:  { heapMB, rssMB, warn: heapMB > HEAP_WARN_MB || rssMB > RSS_WARN_MB },
      disk,
      sessions,
      errors:  { total: this._errorCount },
      node:    process.version,
    };
  }

  async _checkDisk() {
    try {
      // fs.statfs available in Node 19+ (Electron 28+)
      const stat = await fs.promises.statfs(this.userDataDir);
      const free  = Math.round(stat.bfree  * stat.bsize / 1024 / 1024 / 1024 * 10) / 10;
      const total = Math.round(stat.blocks  * stat.bsize / 1024 / 1024 / 1024 * 10) / 10;
      return { freeGB: free, totalGB: total, warn: free < DISK_WARN_GB };
    } catch {
      return { freeGB: null, totalGB: null, warn: false, error: "statfs unavailable" };
    }
  }

  async _countSessions() {
    try {
      // Walk: users/<uid>/booth-output/events/<eid>/sessions/
      let count = 0;
      const userEntries = await fs.promises.readdir(this.usersDir, { withFileTypes: true }).catch(() => []);
      for (const u of userEntries) {
        if (!u.isDirectory()) continue;
        const eventsDir = path.join(this.usersDir, u.name, "booth-output", "events");
        const eventEntries = await fs.promises.readdir(eventsDir, { withFileTypes: true }).catch(() => []);
        for (const e of eventEntries) {
          if (!e.isDirectory()) continue;
          const sessDir = path.join(eventsDir, e.name, "sessions");
          const sessEntries = await fs.promises.readdir(sessDir).catch(() => []);
          count += sessEntries.length;
        }
      }
      return { count, warn: count > SESSION_WARN };
    } catch {
      return { count: null, warn: false, error: "scan failed" };
    }
  }

  _hasWarnings({ heapMB, rssMB, disk, sessions }) {
    return (
      heapMB > HEAP_WARN_MB ||
      rssMB  > RSS_WARN_MB  ||
      disk?.warn             ||
      sessions?.warn
    );
  }

  _emitWarnings(snap) {
    const w = [];
    if (snap.memory?.warn)   w.push(`memory: heap=${snap.memory.heapMB}MB rss=${snap.memory.rssMB}MB`);
    if (snap.disk?.warn)     w.push(`disk: only ${snap.disk.freeGB}GB free`);
    if (snap.sessions?.warn) w.push(`sessions: ${snap.sessions.count} folders accumulated`);
    if (w.length) console.warn("[health] WARNING —", w.join(" | "));
  }

  /** Trim logs older than 30 days to keep disk usage in check. */
  _pruneLogs() {
    for (const f of [this.healthLog, this.errorLog]) {
      try {
        const stat = fs.statSync(f);
        if (stat.size > 10 * 1024 * 1024) { // > 10 MB
          fs.renameSync(f, f + ".old");
        }
      } catch {}
    }
  }
}

module.exports = { HealthMonitor };
