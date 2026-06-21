/**
 * Aurora-Provider v2 — Lean Hono + Bun server.
 *
 * Architecture:
 *   Routes → Services → Lib (DB, Aura Engine)
 *
 * All provider/key/proxy logic removed.
 * Trafic routed through local Bifrost gateway.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { bodyLimit } from 'hono/body-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDb } from './lib/db.js';
import { createAuraService } from './services/aura-service.js';
import { createLogService } from './services/log-service.js';
import { createSettingsService } from './services/settings-service.js';
import { createChatRoute } from './routes/chat.js';
import { createAuraRoutes } from './routes/auras.js';
import { createLogRoutes } from './routes/logs.js';
import { createSettingsRoutes } from './routes/settings.js';
import { createHealthRoute } from './routes/health.js';
import { createUiRoutes } from './routes/ui.js';

// ─── Paths ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VAULT_DIR = join(ROOT, 'vault');
const PUBLIC_DIR = join(__dirname, 'public');

// ─── Bootstrap ──────────────────────────────────────────────────────────────
const db = initDb(VAULT_DIR);
const auraService = createAuraService(VAULT_DIR);
const logService = createLogService(db);
const settingsService = createSettingsService(VAULT_DIR);

// ─── Routes ─────────────────────────────────────────────────────────────────
const app = new Hono();

// Global middlewares
app.use('*', cors());
app.use('*', compress());
app.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024 }));

// UI
const ui = createUiRoutes(PUBLIC_DIR);
app.get('/',            ui.index);
app.get('/index.js',    ui.js);
app.get('/index.css',   ui.css);

// API — Health
const health = createHealthRoute(auraService);
app.get('/api/health', health.check);

// API — Aura management
const auras = createAuraRoutes(auraService);
app.get('/api/auras',              auras.list);
app.post('/api/auras',             auras.createOrUpdate);
app.delete('/api/auras/:name',     auras.remove);

// API — Usage logs
const logs = createLogRoutes(logService);
app.get('/api/logs',       logs.query);
app.post('/api/logs/clear', logs.clear);

// API — Settings
const settings = createSettingsRoutes(settingsService);
app.get('/api/settings', settings.get);
app.put('/api/settings', settings.update);

// API — OpenAI-compatible chat
const chat = createChatRoute(auraService, logService);
app.post('/v1/chat/completions', chat);

// API — Models list (returns aura names as models)
app.get('/v1/models', (c) => {
  const models = auraService.names().map(name => ({
    id: `aurora-provider/${name}`,
    object: 'model',
    created: 1716000000,
    owned_by: 'aurora-provider',
  }));
  return c.json({ object: 'list', data: models });
});

// ─── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '8550', 10);

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch: app.fetch,
});

console.log(`
  Aurora-Provider v2 (Hono on Bun)
  Listening: http://127.0.0.1:${PORT}
  Auras:     ${auraService.names().join(', ') || '(none configured)'}
`);
