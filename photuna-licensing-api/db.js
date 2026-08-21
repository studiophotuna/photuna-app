
// db.js — SQLite local cache. Optional: if better-sqlite3 can't load (e.g. ABI mismatch
// in Electron), we return no-op stubs so the server still starts. All primary data lives
// in Supabase; SQLite is only a fallback cache for offline/slow-network scenarios.
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db.sqlite');

function noop() { return null; }
function noopAll() { return []; }
function noopRun() { return { changes: 0, lastInsertRowid: null }; }
function noopTx(fn) { return fn; }  // returns the function unwrapped; callers still call it

let db = null;

try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);
  console.log('[db] SQLite ready at', DB_PATH);
} catch (err) {
  console.warn('[db] SQLite unavailable — running without local cache:', err.message);
  db = null;
}

module.exports = db
  ? {
      db,
      get: (sql, params = []) => db.prepare(sql).get(params),
      all: (sql, params = []) => db.prepare(sql).all(params),
      run: (sql, params = []) => db.prepare(sql).run(params),
      transaction: (fn) => db.transaction(fn),
    }
  : {
      db: null,
      get: noop,
      all: noopAll,
      run: noopRun,
      transaction: noopTx,
    };
