/**
 * L3 — API Contract Tests
 *
 * Tests every endpoint defined in the system design.
 * Runs against a Hono app instance with test DB — no server required.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, rmSync, mkdirSync, readFileSync } from 'fs';
import { initDb, clearLogs, insertLog } from '../src/lib/db.js';
import { createAuraService } from '../src/services/aura-service.js';
import { createLogService } from '../src/services/log-service.js';
import { createSettingsService } from '../src/services/settings-service.js';
import { createAuraRoutes } from '../src/routes/auras.js';
import { createLogRoutes } from '../src/routes/logs.js';
import { createSettingsRoutes } from '../src/routes/settings.js';
import { createHealthRoute } from '../src/routes/health.js';
import { createChatRoute } from '../src/routes/chat.js';

const TEST_DIR = join(tmpdir(), 'aurora-l3-api-' + Date.now());
let app;
let db;
let auraService;
let logService;

beforeAll(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });

  db = initDb(TEST_DIR);
  auraService = createAuraService(TEST_DIR);
  logService = createLogService(db);
  const settingsService = createSettingsService(TEST_DIR);

  app = new Hono();

  // Register routes exactly like server.js
  const auras = createAuraRoutes(auraService);
  const logs = createLogRoutes(logService);
  const settings = createSettingsRoutes(settingsService);
  const health = createHealthRoute(auraService);
  const chat = createChatRoute(auraService, logService);

  app.get('/api/auras', auras.list);
  app.post('/api/auras', auras.createOrUpdate);
  app.delete('/api/auras/:name', auras.remove);
  app.get('/api/logs', logs.query);
  app.post('/api/logs/clear', logs.clear);
  app.get('/api/settings', settings.get);
  app.put('/api/settings', settings.update);
  app.get('/api/health', health.check);
  app.post('/v1/chat/completions', chat);

  app.get('/v1/models', (c) => {
    const models = auraService.names().map(name => ({
      id: `aurora-provider/${name}`,
      object: 'model',
      created: 1716000000,
      owned_by: 'aurora-provider',
    }));
    return c.json({ object: 'list', data: models });
  });

  // Seed test data
  auraService.upsert('test-single', {
    fallbacks: [{ provider: 'bifrost', model: 'test/model-a', contextWindow: 100000 }],
  });
  auraService.upsert('test-multi', {
    fallbacks: [
      { provider: 'bifrost', model: 'test/primary', contextWindow: 128000 },
      { provider: 'bifrost', model: 'test/fallback', contextWindow: 64000 },
    ],
  });
  auraService.upsert('test-empty-fallback', { fallbacks: [] });
});

afterAll(() => {
  if (db) db.close();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('L3 — API: Health', () => {
  // TC-API-001
  it('TC-API-001: GET /api/health returns status with version and auras', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.version).toBe('2.0.0');
    expect(Array.isArray(data.auras)).toBe(true);
    expect(data.auras).toContain('test-single');
  });

  // TC-API-020
  it('TC-API-021: GET /api/health includes bifrost status and endpoint', async () => {
    const res = await app.request('/api/health');
    const data = await res.json();
    expect(data).toHaveProperty('bifrost');
    expect(data).toHaveProperty('bifrostEndpoint');
    expect(data.bifrostEndpoint).toMatch(/localhost:10550/);
  });
});

describe('L3 — API: Auras', () => {
  // TC-API-002
  it('TC-API-002: GET /api/auras returns configured auras', async () => {
    const res = await app.request('/api/auras');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.auras).toBeDefined();
    expect(data.auras['test-single']).toBeDefined();
    expect(data.auras['test-single'].fallbacks).toHaveLength(1);
  });

  // TC-API-003
  it('TC-API-003: POST /api/auras creates a new aura', async () => {
    const res = await app.request('/api/auras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'api-created-aura',
        fallbacks: [{ provider: 'bifrost', model: 'api/test-model' }],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.aura.name).toBe('api-created-aura');
  });

  // TC-API-004
  it('TC-API-004: POST /api/auras rejects missing name', async () => {
    const res = await app.request('/api/auras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fallbacks: [] }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/name is required/i);
  });

  // TC-API-005
  it('TC-API-005: POST /api/auras rejects missing fallbacks', async () => {
    const res = await app.request('/api/auras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'no-fallbacks' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/fallbacks array is required/i);
  });

  // TC-API-006
  it('TC-API-006: POST /api/auras handles invalid JSON', async () => {
    const res = await app.request('/api/auras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json',
    });
    // Should return 400 or 500 for bad JSON
    expect([400, 500]).toContain(res.status);
  });

  // TC-API-007
  it('TC-API-007: DELETE /api/auras/:name deletes existing aura', async () => {
    // First create
    await app.request('/api/auras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'to-delete-api',
        fallbacks: [{ provider: 'bifrost', model: 'del/model' }],
      }),
    });
    // Then delete
    const res = await app.request('/api/auras/to-delete-api', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  // TC-API-008
  it('TC-API-008: DELETE /api/auras/:name returns 404 for non-existent', async () => {
    const res = await app.request('/api/auras/nonexistent-aura-xyz', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toMatch(/not found/i);
  });
});

describe('L3 — API: Chat Completions', () => {
  // TC-API-010
  it('TC-API-010: POST /v1/chat/completions rejects missing model', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toMatch(/model is required/i);
  });

  // TC-API-011
  it('TC-API-011: POST /v1/chat/completions rejects unknown model', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'totally-unknown-model',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toMatch(/unknown model/i);
  });

  // TC-API-012
  it('TC-API-012: POST /v1/chat/completions handles invalid JSON', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json-at-all',
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toMatch(/invalid_request_error/i);
  });

  // TC-API-013
  it('TC-API-013: POST /v1/chat/completions with empty fallbacks returns 503', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'test-empty-fallback',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error.message).toMatch(/no fallbacks configured/i);
  });

  // TC-API-020
  it('TC-API-020: POST /v1/chat/completions resolves aurora-provider/ prefix', async () => {
    // Test that prefix is stripped — aura with empty fallbacks
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'aurora-provider/test-empty-fallback',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    // Should resolve to test-empty-fallback and fail with exhausted
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error.message).toMatch(/no fallbacks configured/i);
  });
});

describe('L3 — API: Models', () => {
  // TC-API-014
  it('TC-API-014: GET /v1/models returns auras as model list', async () => {
    const res = await app.request('/v1/models');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe('list');
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThanOrEqual(3); // test-single, test-multi, test-empty-fallback + api-created-aura
    const modelIds = data.data.map(m => m.id);
    expect(modelIds).toContain('aurora-provider/test-single');
    expect(modelIds).toContain('aurora-provider/test-multi');
    data.data.forEach(m => {
      expect(m).toHaveProperty('id');
      expect(m).toHaveProperty('object', 'model');
      expect(m).toHaveProperty('owned_by', 'aurora-provider');
    });
  });
});

describe('L3 — API: Usage Logs', () => {
  // TC-API-015
  it('TC-API-015: GET /api/logs returns empty log array initially', async () => {
    // Clear any logs inserted by previous chat error tests
    clearLogs(db);
    const res = await app.request('/api/logs');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.logs)).toBe(true);
    expect(data.totalCount).toBe(0);
  });

  // TC-API-016
  it('TC-API-016: GET /api/logs paginates correctly', async () => {
    // Insert test logs
    for (let i = 0; i < 15; i++) {
      insertLog(db, {
        aura: `test-aura-${i % 3}`,
        model: 'test/model',
        status: 'Success',
        latencyMs: 100 + i * 10,
      });
    }

    const res = await app.request('/api/logs?page=1&limit=10');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.logs.length).toBeLessThanOrEqual(10);
    expect(data.totalCount).toBeGreaterThanOrEqual(15);
    expect(data.success).toBe(true);
  });

  // TC-API-017
  it('TC-API-017: GET /api/logs filters by status', async () => {
    // Insert an error log
    insertLog(db, {
      aura: 'test-error',
      model: 'err/model',
      status: 'Error',
      latencyMs: 0,
      error: 'test error message',
    });

    const res = await app.request('/api/logs?status=Error');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.logs.length).toBeGreaterThanOrEqual(1);
    data.logs.forEach(log => {
      expect(log.status).toBe('Error');
    });
  });

  // TC-API-018
  it('TC-API-018: POST /api/logs/clear clears all logs', async () => {
    const res = await app.request('/api/logs/clear', { method: 'POST' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.message).toBeDefined();

    // Verify cleared
    const checkRes = await app.request('/api/logs');
    const checkData = await checkRes.json();
    expect(checkData.totalCount).toBe(0);
  });
});

describe('L3 — API: Settings', () => {
  // TC-API-019
  it('TC-API-019: GET /api/settings returns settings object', async () => {
    const res = await app.request('/api/settings');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.latencyThreshold).toBe('number');
    expect(typeof data.enableProxy).toBe('boolean');
  });

  // TC-API-021
  it('TC-API-021: PUT /api/settings updates and returns new settings', async () => {
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latencyThreshold: 999 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.latencyThreshold).toBe(999);

    // Verify persistence
    const getRes = await app.request('/api/settings');
    const getData = await getRes.json();
    expect(getData.latencyThreshold).toBe(999);
  });
});

describe('L3 — API: Error Handling & Edge Cases', () => {
  it('GET /api/auras/:undefined returns 404', async () => {
    const res = await app.request('/api/auras/__nonexistent_404__');
    expect(res.status).toBe(404);
  });

  it('GET /nonexistent-route returns 404', async () => {
    const res = await app.request('/api/nonexistent');
    expect(res.status).toBe(404);
  });

  it('POST /api/logs/clear with empty DB returns success', async () => {
    const res = await app.request('/api/logs/clear', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('Settings update only allows known keys', async () => {
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latencyThreshold: 500,
        enableProxy: true,
        unknownField: 'should be ignored',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.unknownField).toBeUndefined();
    expect(data.latencyThreshold).toBe(500);
  });
});
