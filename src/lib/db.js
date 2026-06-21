import { Database } from 'bun:sqlite';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

/**
 * Database layer for aurora-provider.
 * Minimal schema — usage logs only. No proxy/key/provider tables.
 */
export function initDb(vaultDir) {
  if (!existsSync(vaultDir)) {
    mkdirSync(vaultDir, { recursive: true });
  }

  const db = new Database(join(vaultDir, 'vault.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA cache_size = -8000');

  db.run(`CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT (datetime('now')),
    aura TEXT,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'Success',
    latency_ms INTEGER,
    error TEXT
  )`);

  db.run('CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_logs(timestamp)');
  db.run('CREATE INDEX IF NOT EXISTS idx_usage_aura    ON usage_logs(aura)');
  db.run('CREATE INDEX IF NOT EXISTS idx_usage_status  ON usage_logs(status)');

  return db;
}

const INSERT = Symbol('insert');

const stmtCache = new WeakMap();

function prep(db, tag) {
  let cache = stmtCache.get(db);
  if (!cache) {
    cache = {};
    stmtCache.set(db, cache);
  }
  if (cache[tag]) return cache[tag];

  if (tag === INSERT) {
    cache[tag] = db.prepare(
      'INSERT INTO usage_logs (aura, model, status, latency_ms, error) VALUES (?, ?, ?, ?, ?)'
    );
  }
  return cache[tag];
}

export function insertLog(db, { aura, model, status, latencyMs, error } = {}) {
  return prep(db, INSERT).run(
    aura || null,
    model || null,
    status || 'Success',
    latencyMs || 0,
    error || null
  );
}

export function queryLogs(db, filters = {}) {
  const { startDate, endDate, aura, status, page = 1, limit = 50 } = filters;
  const clauses = [];
  const params = [];

  if (startDate) { clauses.push('timestamp >= ?'); params.push(startDate); }
  if (endDate)   { clauses.push('timestamp <= ?'); params.push(endDate + ' 23:59:59'); }
  if (aura)      { clauses.push('aura = ?');        params.push(aura); }
  if (status)    { clauses.push('status = ?');      params.push(status); }

  const where = clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '';
  const offset = (page - 1) * limit;

  const totalCount = db.prepare(`SELECT count(*) as count FROM usage_logs ${where}`).get(...params).count;

  const logs = db.prepare(
    `SELECT * FROM usage_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const successWhere = where
    ? where + " AND status = 'Success'"
    : "WHERE status = 'Success'";

  const successCount = db.prepare(
    `SELECT count(*) as count FROM usage_logs ${successWhere}`
  ).get(...params).count;

  const avgLatency = db.prepare(
    `SELECT avg(latency_ms) as avg FROM usage_logs ${where ? where + ' AND' : 'WHERE'} latency_ms > 0`
  ).get(...params).avg || 0;

  return { logs, totalCount, successCount, avgLatency: Math.round(avgLatency) };
}

export function getLogStats(db, filters = {}) {
  const { startDate, endDate, aura } = filters;
  const clauses = [];
  const params = [];

  if (startDate) { clauses.push('timestamp >= ?'); params.push(startDate); }
  if (endDate)   { clauses.push('timestamp <= ?'); params.push(endDate + ' 23:59:59'); }
  if (aura)      { clauses.push('aura = ?');        params.push(aura); }

  const where = clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '';

  return {
    auras: db.prepare(
      `SELECT aura, count(*) as count FROM usage_logs ${where} GROUP BY aura`
    ).all(...params),
    models: db.prepare(
      `SELECT model, count(*) as count FROM usage_logs ${where} GROUP BY model`
    ).all(...params),
    timeSeries: db.prepare(
      `SELECT date(timestamp) as date, count(*) as count FROM usage_logs ${where} GROUP BY date(timestamp) ORDER BY date ASC`
    ).all(...params),
  };
}

export function clearLogs(db) {
  db.run('DELETE FROM usage_logs');
}

export function getAuraUsage(db, aura) {
  if (!aura) return { total: 0, avgLatency: 0 };
  const row = db.prepare(
    `SELECT count(*) as total, avg(latency_ms) as avgLatency FROM usage_logs WHERE aura = ?`
  ).get(aura);
  return { total: row.total, avgLatency: Math.round(row.avgLatency || 0) };
}
