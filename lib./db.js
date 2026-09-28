const fs = require('fs');
const path = require('path');

async function createPgStore(url) {
  const { Pool } = require('pg');
  const ssl = process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: url, ssl, max: 5 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidates (
      id          TEXT PRIMARY KEY,
      token       TEXT UNIQUE NOT NULL,
      share_token TEXT UNIQUE NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      data        JSONB NOT NULL
    )`);
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0]?.data || null;
  return {
    kind: 'postgres',
    insert: (doc) =>
      pool.query(
        'INSERT INTO candidates (id, token, share_token, created_at, data) VALUES ($1,$2,$3,$4,$5)',
        [doc.id, doc.token, doc.shareToken, doc.createdAt, doc]
      ),
    get: (id) => one('SELECT data FROM candidates WHERE id=$1', [id]),
    byToken: (t) => one('SELECT data FROM candidates WHERE token=$1', [t]),
    byShare: (s) => one('SELECT data FROM candidates WHERE share_token=$1', [s]),
    list: async () =>
      (await pool.query('SELECT data FROM candidates ORDER BY created_at DESC')).rows.map((r) => r.data),
    save: (doc) => pool.query('UPDATE candidates SET data=$2 WHERE id=$1', [doc.id, doc]),
    remove: (id) => pool.query('DELETE FROM candidates WHERE id=$1', [id]),
    purgeBefore: async (iso) =>
      (await pool.query('DELETE FROM candidates WHERE created_at < $1', [iso])).rowCount,
    ping: () => pool.query('SELECT 1'),
  };
}

async function createFileStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let rows = [];
  if (fs.existsSync(file)) {
    try {
      rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      rows = [];
    }
  }
  const flush = () => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
    fs.renameSync(tmp, file);
  };
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  return {
    kind: 'file',
    insert: async (doc) => {
      rows.push(clone(doc));
      flush();
    },
    get: async (id) => clone(rows.find((r) => r.id === id)),
    byToken: async (t) => clone(rows.find((r) => r.token === t)),
    byShare: async (s) => clone(rows.find((r) => r.shareToken === s)),
    list: async () =>
      clone(rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))),
    save: async (doc) => {
      const i = rows.findIndex((r) => r.id === doc.id);
      if (i >= 0) rows[i] = clone(doc);
      flush();
    },
    remove: async (id) => {
      rows = rows.filter((r) => r.id !== id);
      flush();
    },
    purgeBefore: async (iso) => {
      const before = rows.length;
      rows = rows.filter((r) => r.createdAt >= iso);
      flush();
      return before - rows.length;
    },
    ping: async () => true,
  };
}

async function createStore() {
  if (process.env.DATABASE_URL) return createPgStore(process.env.DATABASE_URL);
  const file = process.env.DATA_FILE || path.join(__dirname, '..', '.data', 'candidates.json');
  return createFileStore(file);
}

module.exports = { createStore };
