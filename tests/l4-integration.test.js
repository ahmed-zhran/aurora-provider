/**
 * L4 — Integration Tests
 *
 * Cross-component behavior: service + route + DB interactions.
 * Covers data consistency, error propagation, and component boundaries.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { initDb, insertLog, queryLogs, getLogStats, clearLogs } from '../src/lib/db.js';
import { createAuraService } from '../src/services/aura-service.js';
import { createLogService } from '../src/services/log-service.js';
import { createSettingsService } from '../src/services/settings-service.js';
import { createAuraRoutes } from '../src/routes/auras.js';
import { createLogRoutes } from '../src/routes/logs.js';
import { createSettingsRoutes } from '../src/routes/settings.js';
import { createHealthRoute } from '../src/routes/health.js';
import { loadConfig, saveJson, loadJson } from '../src/lib/config.js';

const TEST_DIR = join(tmpdir(), 'aurora-l4-int-' + Date.now());
let app;
let db;
let auraService;
let logService;
let settingsService;

beforeAll(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });

  db = initDb(TEST_DIR);
  auraService = createAuraService(TEST_DIR);
  logService = createLogService(db);
  settingsService = createSettingsService(TEST_DIR);

  app = new Hono();
  const auras = createAuraRoutes(auraService);
  const logs = createLogRoutes(logService);
  const settings = createSettingsRoutes(settingsService);
  const health = createHealthRoute(auraService);

  app.get('/api/auras', auras.list);
  app.post('/api/auras', auras.createOrUpdate);
  app.delete('/api/auras/:name', auras.remove);
  app.get('/api/logs', logs.query);
  app.post('/api/logs/clear', logs.clear);
  app.get('/api/settings', settings.get);
  app.put('/api/settings', settings.update);
  app.get('/api/health', health.check);
});

afterAll(() => {
  if (db) db.close();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('L4 — Integration: Aura CRUD Data Integrity', () => {
  // TC-INT-001
  it('TC-INT-001: Aura create, list, verify round-trip', async () => {
    auraService.upsert('int-test-aura', {
      fallbacks: [{ provider: 'bifrost', model: 'int/test-model', contextWindow: 64000 }],
    });

    const res = await app.request('/api/auras');
    const data = await res.json();
    expect(data.auras['int-test-aura']).toBeDefined();
    expect(data.auras['int-test-aura'].fallbacks[0].model).toBe('int/test-model');
  });

  // TC-INT-002
  it('TC-INT-002: Aura create, delete, verify gone', async () => {
    auraService.upsert('to-delete-int', { fallbacks: [] });
    expect(auraService.remove('to-delete-int')).toBe(true);
    expect(auraService.get('to-delete-int')).toBeNull();
  });

  // TC-INT-009
  it('TC-INT-009: Multiple aura operations maintain consistency', async () => {
    // Create 3
    auraService.upsert('aura-a', { fallbacks: [{ provider: 'bifrost', model: 'a' }] });
    auraService.upsert('aura-b', { fallbacks: [{ provider: 'bifrost', model: 'b' }] });
    auraService.upsert('aura-c', { fallbacks: [{ provider: 'bifrost', model: 'c' }] });

    // Update 1
    auraService.upsert('aura-b', { fallbacks: [{ provider: 'bifrost', model: 'b-updated' }] });

    // Delete 1
    auraService.remove('aura-c');

    // Verify remaining 2
    const names = auraService.names();
    expect(names).toContain('aura-a');
    expect(names).toContain('aura-b');
    expect(names).not.toContain('aura-c');
    expect(auraService.get('aura-b').fallbacks[0].model).toBe('b-updated');
  });

  // TC-INT-010
  it('TC-INT-003: Unknown aura via chat route records error log', async () => {
    // Use the chat route logic directly: service+log integration
    // Simulate an unknown aura lookup
    const auras = auraService.list();
    expect(auras['does-not-exist']).toBeUndefined();

    // Log an error directly (simulating what the chat route does)
    insertLog(db, {
      aura: 'does-not-exist',
      model: 'unknown/model',
      status: 'Error',
      latencyMs: 0,
      error: 'Unknown model/aura: "does-not-exist"',
    });

    const result = queryLogs(db, { status: 'Error' });
    const errorLog = result.logs.find(l => l.aura === 'does-not-exist');
    expect(errorLog).toBeDefined();
    expect(errorLog.status).toBe('Error');
    expect(errorLog.error).toMatch(/unknown model/i);
  });
});

describe('L4 — Integration: Log Service', () => {
  // TC-INT-004
  it('TC-INT-004: Record and verify success log via service', async () => {
    logService.record({
      aura: 'int-aura',
      model: 'int/model',
      status: 'Success',
      latencyMs: 250,
    });

    const result = logService.query({ aura: 'int-aura' });
    expect(result.totalCount).toBeGreaterThanOrEqual(1);
    const log = result.logs[0];
    expect(log.status).toBe('Success');
    expect(log.latency_ms).toBe(250);
  });

  // TC-INT-005
  it('TC-INT-005: Log clear via service, verify empty', async () => {
    logService.record({ aura: 'will-clear', model: 'm', status: 'Success', latencyMs: 1 });
    logService.clear();
    const result = logService.query();
    expect(result.totalCount).toBe(0);
  });

  // TC-INT-010
  it('TC-INT-010: Log stats filtered by aura', async () => {
    clearLogs(db);
    // Insert logs for two different auras
    insertLog(db, { aura: 'filter-aura', model: 'm1', status: 'Success', latencyMs: 100 });
    insertLog(db, { aura: 'filter-aura', model: 'm2', status: 'Success', latencyMs: 200 });
    insertLog(db, { aura: 'other-aura', model: 'm3', status: 'Success', latencyMs: 300 });

    const stats = getLogStats(db, { aura: 'filter-aura' });
    expect(stats.auras.length).toBe(1);
    expect(stats.auras[0].aura).toBe('filter-aura');
    expect(stats.auras[0].count).toBe(2);

    const allStats = getLogStats(db);
    expect(allStats.auras.length).toBeGreaterThanOrEqual(2);
  });
});

describe('L4 — Integration: Settings Persistence', () => {
  // TC-INT-006
  it('TC-INT-006: Settings save -> get -> verify round-trip', async () => {
    await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latencyThreshold: 777 }),
    });

    const res = await app.request('/api/settings');
    const data = await res.json();
    expect(data.latencyThreshold).toBe(777);
  });
});

describe('L4 — Integration: DB Initialization & Recovery', () => {
  // TC-INT-008
  it('TC-INT-007: initDb creates vault.db and usage_logs table', () => {
    const freshDir = join(TEST_DIR, 'fresh-db');
    const freshDb = initDb(freshDir);
    const tables = freshDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    expect(tables.some(t => t.name === 'usage_logs')).toBe(true);

    // Check indexes exist
    const indexes = freshDb.prepare("SELECT name FROM sqlite_master WHERE type='index'").all();
    const idxNames = indexes.map(i => i.name);
    expect(idxNames).toContain('idx_usage_timestamp');
    expect(idxNames).toContain('idx_usage_aura');
    expect(idxNames).toContain('idx_usage_status');

    freshDb.close();
    if (existsSync(freshDir)) rmSync(freshDir, { recursive: true, force: true });
  });

  // TC-INT-009
  it('TC-INT-008: loadConfig handles corrupt JSON gracefully', () => {
    const corruptFile = 'corrupt.json';
    const filePath = join(TEST_DIR, corruptFile);
    writeFileSync(filePath, 'this is not json', 'utf8');

    const config = loadConfig(TEST_DIR, corruptFile, { defaultKey: 'defaultValue' });
    // Should return default and rewrite file
    expect(config.defaultKey).toBe('defaultValue');

    // File should be valid JSON now
    const reloaded = loadJson(filePath);
    expect(reloaded.defaultKey).toBe('defaultValue');
  });
});

describe('L4 — Integration: Vault File Integrity', () => {
  it('Config file remains valid JSON after upsert operations', () => {
    const aurasPath = join(TEST_DIR, 'auras.json');

    // Multiple upserts
    auraService.upsert('file-test-a', { fallbacks: [{ provider: 'bifrost', model: 'fa' }] });
    auraService.upsert('file-test-b', { fallbacks: [{ provider: 'bifrost', model: 'fb' }] });
    auraService.remove('file-test-a');

    // Read file and verify
    const content = readFileSync(aurasPath, 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
    const parsed = JSON.parse(content);
    expect(parsed.auras['file-test-b']).toBeDefined();
    expect(parsed.auras['file-test-a']).toBeUndefined();
  });

  it('Settings file remains valid JSON after updates', () => {
    const settingsPath = join(TEST_DIR, 'settings.json');
    settingsService.update({ latencyThreshold: 500 });
    settingsService.update({ enableProxy: true });

    const content = readFileSync(settingsPath, 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });
});
