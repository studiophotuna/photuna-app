
// db.js
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'db.sqlite');
const db = new Database(DB_PATH);

const schema = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf-8');
db.exec(schema);

module.exports = {
  db,
  // helpers
  get: (sql, params = []) => db.prepare(sql).get(params),
  all: (sql, params = []) => db.prepare(sql).all(params),
  run: (sql, params = []) => db.prepare(sql).run(params),
  transaction: (fn) => db.transaction(fn),
};
