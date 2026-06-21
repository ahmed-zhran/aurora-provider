import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { initDb, insertLog, queryLogs, getLogStats, clearLogs, getAuraUsage } from '../src/lib/db.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, rmSync, mkdirSync } from 'fs';

const TEST_DIR = join(tmpdir(), 'aurora-test-' + Date.now());

let db;

beforeAll(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  db = initDb(TEST_DIR);
});

afterAll(() => {
  if (db) db.close();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('db.js — Database Layer (L5)', () => {
  it('initializes SQLite with usage_logs table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    expect(tables.some(t => t.name === 'usage_logs')).toBe(true);
  });

  it('insertLog adds a success record', () => {
    const result = insertLog(db, { aura: 'test-aura', model: 'test/model', status: 'Success', latencyMs: 150 });
    expect(result.lastInsertRowid).toBeGreaterThan(0);
  });

  it('insertLog adds an error record', () => {
    insertLog(db, { aura: 'test-aura', model: 'test/model2', status: 'Error', latencyMs: 0, error: 'timeout' });
  });

  it('queryLogs returns paginated results', () => {
    const result = queryLogs(db, { limit: 10, page: 1 });
    expect(result.logs.length).toBeGreaterThanOrEqual(2);
    expect(result.totalCount).toBeGreaterThanOrEqual(2);
    expect(result.successCount).toBeGreaterThanOrEqual(1);
    expect(result.avgLatency).toBeGreaterThan(0);
  });

  it('queryLogs supports filters', () => {
    const result = queryLogs(db, { status: 'Error' });
    expect(result.logs.length).toBeGreaterThanOrEqual(1);
    result.logs.forEach(log => {
      expect(log.status).toBe('Error');
    });
  });

  it('getLogStats returns aggregate data', () => {
    const stats = getLogStats(db);
    expect(stats.auras).toBeDefined();
    expect(stats.models).toBeDefined();
    expect(stats.timeSeries).toBeDefined();
    expect(stats.auras.length).toBeGreaterThanOrEqual(1);
  });

  it('clearLogs removes all records', () => {
    clearLogs(db);
    const result = queryLogs(db);
    expect(result.totalCount).toBe(0);
  });

  it('getAuraUsage returns stats for a specific aura', () => {
    insertLog(db, { aura: 'usage-test', model: 'm1', status: 'Success', latencyMs: 100 });
    insertLog(db, { aura: 'usage-test', model: 'm2', status: 'Success', latencyMs: 200 });
    const usage = getAuraUsage(db, 'usage-test');
    expect(usage.total).toBe(2);
    expect(usage.avgLatency).toBe(150);
  });

  it('getAuraUsage returns zeros for unknown aura', () => {
    const usage = getAuraUsage(db, 'nonexistent');
    expect(usage.total).toBe(0);
    expect(usage.avgLatency).toBe(0);
  });
});
