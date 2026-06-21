import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { initDb } from '../src/lib/db.js';
import { createAuraService } from '../src/services/aura-service.js';
import { createLogService } from '../src/services/log-service.js';
import { createSettingsService } from '../src/services/settings-service.js';
import { createAuraRoutes } from '../src/routes/auras.js';
import { createLogRoutes } from '../src/routes/logs.js';
import { createSettingsRoutes } from '../src/routes/settings.js';
import { createHealthRoute } from '../src/routes/health.js';

const TEST_DIR = join(tmpdir(), 'aurora-routes-test-' + Date.now());
let app;
let db;

beforeAll(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  db = initDb(TEST_DIR);
  const auraService = createAuraService(TEST_DIR);
  const logService = createLogService(db);
  const settingsService = createSettingsService(TEST_DIR);

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

  // Seed data
  auraService.upsert('test-aura', { fallbacks: [{ provider: 'bifrost', model: 'test/model' }] });
});

afterAll(() => {
  if (db) db.close();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('API Routes (L6)', () => {
  // ─── Health ───
  it('GET /api/health returns status', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.version).toBe('2.0.0');
    expect(Array.isArray(data.auras)).toBe(true);
  });

  // ─── Auras ───
  it('GET /api/auras returns aura list', async () => {
    const res = await app.request('/api/auras');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.auras['test-aura']).toBeDefined();
  });

  it('POST /api/auras creates a new aura', async () => {
    const res = await app.request('/api/auras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new-aura', fallbacks: [{ provider: 'bifrost', model: 'm1' }] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('POST /api/auras validates required fields', async () => {
    const res = await app.request('/api/auras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'invalid' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/auras/:name deletes an aura', async () => {
    const res = await app.request('/api/auras/to-delete', { method: 'DELETE' });
    expect(res.status).toBe(404); // doesn't exist
  });

  it('DELETE /api/auras/:name returns 200 for existing aura', async () => {
    // Create then delete
    await app.request('/api/auras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'delete-me', fallbacks: [] }),
    });
    const res = await app.request('/api/auras/delete-me', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  // ─── Logs ───
  it('GET /api/logs returns empty logs', async () => {
    const res = await app.request('/api/logs');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.logs)).toBe(true);
  });

  it('POST /api/logs/clear clears logs', async () => {
    const res = await app.request('/api/logs/clear', { method: 'POST' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  // ─── Settings ───
  it('GET /api/settings returns settings', async () => {
    const res = await app.request('/api/settings');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.latencyThreshold).toBe('number');
  });

  it('PUT /api/settings updates settings', async () => {
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latencyThreshold: 200 }),
    });
    expect(res.status).toBe(200);
  });
});
