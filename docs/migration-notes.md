# Migration Notes — v1 to v2

> Breaking changes, removed features, and migration guide for upgrading from Aurora-Provider v1 to v2.

---

## Overview

Aurora-Provider v2 is a **fundamentally different architecture**. v1 was a self-contained multi-provider LLM router with built-in API key management, SOCKS5 proxy pool, and rate-limit handling. v2 is a **lean aura router** that delegates all provider interactions to the Bifrost AI Gateway.

**TL;DR:** v2 is not a drop-in upgrade. If you rely on v1's multi-provider routing, key rotation, or proxy pool, you need Bifrost.

---

## Breaking Changes

### 1. Architecture Change: Bifrost Required

**v1:** Aurora-Provider connected directly to LLM providers (Google AI Studio, Groq, OpenRouter, etc.)

**v2:** Aurora-Provider routes all traffic through Bifrost Gateway. Bifrost must be running on `localhost:10550` for any request to succeed.

**Action:** Install and configure [Bifrost](https://github.com/ahmed-zhran/bifrost).

### 2. Port Changed

**v1:** Default port 9001

**v2:** Default port 8550

**Action:** Update your tool configurations (`apiBase`) from `http://127.0.0.1:9001` to `http://127.0.0.1:8550`.

### 3. API Endpoint Changes

| v1 Endpoint | v2 Endpoint | Status |
|-------------|-------------|--------|
| `GET /health` | `GET /api/health` | Changed |
| `POST /v1/chat/completions` | Same | Unchanged |
| `GET /v1/models` | Same | Unchanged |
| `GET /api/usage` | `GET /api/logs` | Changed |
| `POST /api/usage/clear` | `POST /api/logs/clear` | Changed |
| `GET /api/auras` | Same | Unchanged |
| `POST /api/auras` | Same | Unchanged |
| `POST /api/auras` (save) | Same | Unchanged |
| `GET /api/settings` | Same | Unchanged |
| `POST /api/settings` | `PUT /api/settings` | Changed |
| `DELETE /api/auras/:name` | New | Added |
| `GET /api/config` | Removed | — |
| `POST /api/keys` | Removed | — |
| `POST /api/providers` | Removed | — |
| `GET /api/proxies` | Removed | — |
| `POST /api/proxies/refresh` | Removed | — |
| `GET /api/logs-stream` | Removed | — |
| `GET /status` | Removed | — |

### 4. Response Body Changes

**Usage logs (`GET /api/logs`):** Response format changed significantly:

v1 response column set: `id, timestamp, aura, provider, model, key_index, key_name, key_email, proxy, source, prompt, response, status, error_message, latency_ms, prompt_tokens, completion_tokens, total_tokens, request_host`

v2 response column set: `id, timestamp, aura, model, status, latency_ms, error`

| Dropped Column | Reason |
|----------------|--------|
| `provider` | Always "bifrost" now |
| `key_index`, `key_name`, `key_email` | Key management moved to Bifrost |
| `proxy` | Proxy layer moved to Bifrost |
| `source` | Only API source now |
| `prompt`, `response` | PII concern, not needed for usage stats |
| `prompt_tokens`, `completion_tokens`, `total_tokens` | Token data not available through Bifrost |
| `request_host` | Not useful without proxy analytics |
| `error_message` | Renamed to `error` |

### 5. Configuration File Changes

| v1 File | v2 Status | Notes |
|---------|-----------|-------|
| `vault/auras.json` | Kept | Format unchanged |
| `vault/settings.json` | Kept | Fields changed |
| `vault/keys.json` | Removed | Keys managed in Bifrost |
| `vault/providers.json` | Kept | Informational only (not used by v2 server) |

### 6. Removal of Proxy Pool

v1 included a built-in SOCKS5 proxy pool with auto-scraping, testing, and rotation. v2 has no proxy layer — all requests go directly to Bifrost on localhost. If proxy routing is needed, configure it in Bifrost.

### 7. Removal of SSE Log Streaming

v1 had `GET /api/logs-stream` for real-time log SSE. v2 does not include this feature. Use Bifrost's logging if real-time log streaming is needed.

### 8. Removal of Key Health Probe

v1 had a background health probe that checked all API keys every 15 minutes. v2 has no key management — this responsibility is handled by Bifrost.

### 9. Database Schema Change

The `usage_logs` table schema is simplified. If you have existing v1 data, run the migration script below.

---

## Database Migration

If you have an existing `vault/vault.db` from v1 with data you want to keep:

```sql
-- Step 1: Create new table with v2 schema
CREATE TABLE usage_logs_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT (datetime('now')),
  aura TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'Success',
  latency_ms INTEGER,
  error TEXT
);

-- Step 2: Copy existing data
INSERT INTO usage_logs_v2 (id, timestamp, aura, model, status, latency_ms, error)
SELECT id, timestamp, aura, model, status, latency_ms, error_message
FROM usage_logs;

-- Step 3: Drop old table, rename new
DROP TABLE usage_logs;
ALTER TABLE usage_logs_v2 RENAME TO usage_logs;

-- Step 4: Drop old proxy-related table
DROP TABLE IF EXISTS proxy_refresh_logs;

-- Step 5: Recreate indexes
CREATE INDEX idx_usage_timestamp ON usage_logs(timestamp);
CREATE INDEX idx_usage_status ON usage_logs(status);
CREATE INDEX idx_usage_aura ON usage_logs(aura);
```

**Rollback:** Keep a backup of the old `vault.db` before migration.

---

## Dashboard Changes

| v1 Tab | v2 Status |
|--------|-----------|
| Dashboard (KPIs, charts, logs) | Kept |
| Aura Hub | Kept (renamed to "Auras") |
| API Tester | Kept |
| API Keys and Health | Removed (keys managed by Bifrost) |
| Proxy Pool | Removed (no proxy layer) |
| Provider Config | Removed (sole provider is Bifrost) |
| Live Logs | Removed |
| Supported Providers | Removed |

---

## Dependency Changes

### Removed Dependencies

| Package | Reason |
|---------|--------|
| `https-proxy-agent` | No proxy layer |
| `socks` | No SOCKS5 proxy |
| `socks-proxy-agent` | No proxy layer |
| `node-fetch` | Use built-in fetch (Bun has native fetch) |
| `undici` | Use built-in fetch |

### Kept Dependencies

| Package | Version | Reason |
|---------|---------|--------|
| `hono` | ^4.x | Web framework (unchanged) |
| `marked` | ^18.x | Dashboard markdown rendering |
| `marked-gfm-heading-id` | ^4.x | Dashboard markdown rendering |

---

## Upgrade Steps

1. **Install Bifrost** — clone and configure the Bifrost Gateway
2. **Migrate API keys** — move all API keys from `vault/keys.json` to Bifrost's configuration
3. **Backup vault.db** — `cp vault/vault.db vault/vault.db.v1-backup`
4. **Run DB migration** (if keeping old logs)
5. **Update port** — change tool configs from 9001 to 8550
6. **Start Bifrost** — ensure it's running before starting aurora-provider
7. **Start aurora-provider v2** — `bun run start`
8. **Verify** — check `GET /api/health` returns `"bifrost": "connected"`

---

*Last updated: 2026-06-21*
