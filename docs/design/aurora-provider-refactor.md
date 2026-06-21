
### What Is Removed

| Module | Lines Removed | Rationale |
|--------|--------------|-----------|
| Proxy pool (scraping 40+ sources, SOCKS5/HTTP, testing, rate limiting) | ~600 | Proxy layer handled externally if needed -- aurora-provider is a local router |
| Key rotation and rate-limit tracking (cooldown, exhaustion, health probes) | ~200 | Bifrost manages API keys per provider |
| Model metadata heuristics (context window, capabilities, reasoning detection) | ~200 | Static config in auras.json defines model metadata per fallback step |
| SSE log broadcasting (console.log wrapper) | ~30 | Replace with structured logging via the logging service |
| Provider config management APIs (GET/POST /api/providers) | ~80 | Bifrost is the only provider |
| Key config management APIs (GET/POST /api/keys, probe) | ~100 | No keys managed here |
| Background key health probes | ~30 | Not needed when no keys managed |
| Model settings (markFree, model_settings.json) | ~100 | Not relevant without multi-provider routing |
| Detached proxy refresh log table | ~80 | No proxy pool to log |
| **Total removed** | **~1,420** | |

### What Stays (Refactored)

| Module | Notes |
|--------|-------|
| Hono app + middleware (CORS, compress, bodyLimit) | Stays as-is |
| /v1/chat/completions endpoint | Simplified -- no proxy, no key logic |
| /v1/models endpoint | Simplified -- lists aura names |
| Usage logging to SQLite | Simplified schema (no proxy/key fields) |
| Dashboard UI | Refactored -- remove keys/proxies/provider-config tabs |
| Vault config files | Simplified -- only auras.json + settings.json remain in active use |

## API Contracts

### OpenAI-Compatible Endpoints

#### Endpoint: POST /v1/chat/completions

**Auth required:** No (local only)
**Rate limited:** No (Bifrost handles rate limits)

**Request:**
```json
{
  "model": "aurora-provider/seolla-nyx-aura",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "stream": false,
  "max_tokens": 1024,
  "temperature": 0.7
}
```

**Success Response (200, non-streaming):**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1716000000,
  "model": "aurora-provider/seolla-nyx-aura",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

**Success Response (200, streaming):**
Returns standard SSE stream with data: {...} chunks, identical to OpenAI SSE format. The proxy re-streams Bifrost's SSE output directly.

**Error Responses:**

| Status | Condition | Body |
|--------|-----------|------|
| 400 | Unknown aura/model | { "error": { "message": "Unknown model/aura: ...", "type": "invalid_request_error" } } |
| 413 | Payload too large | { "error": "Payload Too Large" } |
| 500 | Internal error | { "error": { "message": "Internal server error", "type": "internal_error" } } |
| 503 | All fallbacks exhausted | { "error": { "message": "Aurora-Provider: ALL_FALLBACKS_EXHAUSTED for aura ...", "type": "service_unavailable" } } |


#### Endpoint: GET /v1/models

**Auth required:** No

**Success Response (200):**
```json
{
  "object": "list",
  "data": [
    {
      "id": "aurora-provider/seolla-nyx-aura",
      "object": "model",
      "created": 1716000000,
      "owned_by": "aurora-provider"
    }
  ]
}
```

### Health and Status

#### Endpoint: GET /health

**Success Response (200):**
```json
{
  "status": "ok",
  "version": "2.0.0",
  "auras": ["seolla-nyx-aura", "lyra-nyx-aura"]
}
```

### Dashboard UI

#### Endpoint: GET /

Serves the single-page dashboard HTML. Static assets at /index.js and /index.css.

### Usage Logs

#### Endpoint: GET /api/usage

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| startDate | string (YYYY-MM-DD) | Filter logs from this date |
| endDate | string (YYYY-MM-DD) | Filter logs to this date |
| aura | string | Filter by aura name |
| status | string | Filter by status ("Success" or "Error") |
| page | number (default: 1) | Page number |
| limit | number (default: 50) | Items per page |

**Success Response (200):**
```json
{
  "success": true,
  "logs": [
    {
      "id": 1,
      "timestamp": "2026-06-21 12:00:00",
      "aura": "seolla-nyx-aura",
      "model": "opencode-zen/big-pickle",
      "source": "API",
      "status": "Success",
      "latency_ms": 1234,
      "prompt_tokens": 100,
      "completion_tokens": 50,
      "total_tokens": 150
    }
  ],
  "totalCount": 100,
  "successCount": 90,
  "avgLatency": 1200,
  "totalTokens": 15000,
  "stats": {
    "providers": [{ "provider": "bifrost", "count": 100 }],
    "models": [{ "model": "opencode-zen/big-pickle", "count": 60 }],
    "timeSeries": [{ "date": "2026-06-21", "count": 100 }]
  }
}
```

#### Endpoint: POST /api/usage/clear

**Success Response (200):** { "success": true, "message": "Request logs history cleared." }

### Aura Management

#### Endpoint: GET /api/auras

Returns the current aura configurations.

**Success Response (200):**
```json
{
  "auras": {
    "seolla-nyx-aura": {
      "fallbacks": [
        { "provider": "bifrost", "model": "opencode-zen/big-pickle", "contextWindow": 200000, "reasoning": true },
        { "provider": "bifrost", "model": "mistral/mistral-medium-3-5", "contextWindow": 262144 }
      ]
    }
  }
}
```

#### Endpoint: POST /api/auras

**Request:**
```json
{
  "auras": {
    "my-aura": {
      "fallbacks": [
        { "provider": "bifrost", "model": "some-model", "contextWindow": 128000 }
      ]
    }
  }
}
```

**Success Response (200):** { "success": true }

### Settings

#### Endpoint: GET /api/settings

**Success Response (200):**
```json
{
  "port": 10550,
  "version": "2.0.0"
}
```

#### Endpoint: POST /api/settings

**Request:**
```json
{
  "port": 10550
}
```

**Success Response (200):** { "success": true }


## Data Model

### Tables

#### usagelogs

```sql
CREATE TABLE usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
  aura TEXT,
  model TEXT,
  source TEXT,
  status TEXT,
  error_message TEXT,
  latency_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER
);

CREATE INDEX idx_usage_timestamp ON usage_logs(timestamp);
CREATE INDEX idx_usage_status ON usage_logs(status);
CREATE INDEX idx_usage_aura ON usage_logs(aura);
```

### Schema Changes from v1

| Old Column | Status | Reason |
|-----------|--------|--------|
| provider | REMOVED | Always "bifrost" now |
| key_index | REMOVED | No key management |
| key_name | REMOVED | No key management |
| key_email | REMOVED | No key management |
| proxy | REMOVED | No proxy layer |
| prompt | REMOVED | PII concern, not needed for usage stats |
| response | REMOVED | PII concern, not needed for usage stats |
| request_host | REMOVED | Not useful without proxy analytics |
| proxy_enabled | REMOVED | No proxy layer |

### Migration

```sql
-- Step 1: Create new table
CREATE TABLE usage_logs_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
  aura TEXT,
  model TEXT,
  source TEXT,
  status TEXT,
  error_message TEXT,
  latency_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER
);

-- Step 2: Copy existing data (map relevant fields)
INSERT INTO usage_logs_v2 (id, timestamp, aura, model, source, status, error_message, latency_ms, prompt_tokens, completion_tokens, total_tokens)
SELECT id, timestamp, aura, model, source, status, error_message, latency_ms, prompt_tokens, completion_tokens, total_tokens
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

**Rollback:** Keep a backup of vault/vault.db before migration. Rename back to restore.

**Breaking change?** Yes -- columns are dropped. Existing data is preserved in the migrated columns. Old v1 client queries against the usage API will get fewer fields but won't break structurally.

## Component Breakdown

### Directory Structure

```
aurora-provider/
├── src/
│   ├── index.js                  -- Entry point -- server bootstrap
│   ├── app.js                    -- Hono app factory + middleware registration
│   ├── routes/
│   │   ├── completions.js        -- POST /v1/chat/completions, GET /v1/models
│   │   ├── health.js             -- GET /health
│   │   └── api/
│   │       ├── auras.js          -- GET/POST /api/auras
│   │       ├── usage.js          -- GET /api/usage, POST /api/usage/clear
│   │       └── settings.js       -- GET/POST /api/settings
│   ├── services/
│   │   ├── usage-logger.js       -- SQLite usage logging service
│   │   ├── config.js             -- Config file loader/saver (auras.json, settings.json)
│   │   └── dashboard.js          -- Static file serving for UI
│   ├── engine/
│   │   └── aura-engine.js        -- Aura resolution + fallback dispatch to Bifrost
│   ├── public/                   -- Dashboard UI
│   │   ├── index.html
│   │   ├── index.js
│   │   └── index.css
│   └── db/
│       └── schema.js             -- DB initialization + migration logic
├── vault/
│   ├── auras.json                -- Aura definitions (fallback chains)
│   ├── settings.json             -- Server settings
│   ├── vault.db                  -- SQLite database (usage logs)
│   └── .gitkeep                  -- Ensure vault dir exists in git
├── docs/
│   └── design/
│       └── aurora-provider-refactor.md   -- This document
├── package.json
├── AGENTS.md
└── .env
```


### Component Responsibilities

#### src/index.js -- Entry Point
- Loads environment config (port from env or defaults)
- Initializes database (schema.js)
- Creates Hono app (app.js)
- Starts Bun/Hono HTTP server
- Single file, <30 lines

#### src/app.js -- App Factory
- Creates Hono instance
- Registers global middleware (CORS, compress, bodyLimit)
- Mounts route modules
- Exports createApp() function

#### src/routes/completions.js -- Completions Route
- POST /v1/chat/completions -- Core endpoint
  - Parses body, extracts model/aura
  - Resolves aura name from model ID
  - Calls aura-engine.dispatch()
  - Handles streaming vs non-streaming response
  - Logs usage via usage-logger (asynchronous, fire-and-forget)
  - Returns OpenAI-compatible response
- GET /v1/models -- Lists all aura names as models

#### src/routes/health.js -- Health Route
- GET /health -- Returns status, version, active auras

#### src/routes/api/auras.js -- Aura Config Routes
- GET /api/auras -- Returns current auras configuration
- POST /api/auras -- Updates auras configuration (persists to vault)

#### src/routes/api/usage.js -- Usage Log Routes
- GET /api/usage -- Query usage logs with filters, pagination, statistics
- POST /api/usage/clear -- Clear all usage logs

#### src/routes/api/settings.js -- Settings Routes
- GET /api/settings -- Return current server settings
- POST /api/settings -- Update server settings

#### src/services/usage-logger.js -- Usage Logging Service
- Initializes usage_logs table
- Provides log(data) method -- inserts a usage record
- Provides query(filters) method -- paginated query with stats
- Provides clear() method -- truncate logs
- All DB operations use prepared statements

#### src/services/config.js -- Config Service
- loadAuras() -- Loads and caches auras.json
- saveAuras(auras) -- Persists to vault
- loadSettings() / saveSettings(settings) -- Same for settings.json
- Handles file-not-found gracefully with sensible defaults

#### src/engine/aura-engine.js -- Core Dispatch Engine
- resolveAura(modelId) -- Extracts aura name from aurora-provider/<aura-name> format
- dispatch(auraName, body) -- Core dispatch loop:
  1. Looks up aura config from loaded auras
  2. Iterates fallback chain in order
  3. For each fallback, forwards request to Bifrost POST /v1/chat/completions
  4. If success, returns response immediately
  5. If failure (network error, non-2xx), logs error and tries next fallback
  6. If all exhausted, returns ALL_FALLBACKS_EXHAUSTED error
- No retry logic -- each fallback is tried once; Bifrost handles retries
- No proxy -- direct connection to local Bifrost
- No key handling -- Bifrost handles auth

#### src/db/schema.js -- Database Schema
- Creates/opens SQLite database
- Runs table creation + migration SQL
- Exports getDb() for use by services

### Dashboard UI (src/public/)

The existing dashboard UI is refactored to remove tabs that are no longer relevant. Remaining tabs:

1. **Dashboard** -- Usage stats, charts, live log view (stays as-is, minus proxy fields)
2. **Aura Hub** -- View and edit aura configurations (stays as-is)
3. **API Tester** -- Quick test endpoint (stays as-is)

**Removed tabs:**
- API Keys and Health (keys managed by Bifrost)
- Proxy Pool (no proxy layer)
- Provider Config (sole provider is Bifrost, not configurable here)
- Supported Providers (static list removed, Bifrost provides catalog)

### Dependency Changes

#### Removed Dependencies
| Package | Reason |
|---------|--------|
| https-proxy-agent | No proxy layer |
| socks | No SOCKS5 proxy |
| socks-proxy-agent | No proxy layer |
| node-fetch | Use built-in fetch (Bun has native fetch) |
| undici | Use built-in fetch |

#### Kept Dependencies
| Package | Version | Reason |
|---------|---------|--------|
| hono | ^4.x | Web framework (unchanged) |
| marked | ^18.x | Dashboard -- future markdown rendering |
| marked-gfm-heading-id | ^4.x | Dashboard -- future markdown rendering |

#### Engine Changes
- Change from bun runtime (already Bun, stays Bun)
- No new runtime dependencies needed

## Error Handling Strategy

### Error Types

| Error | HTTP Status | When | Response Body |
|-------|-------------|------|---------------|
| UNKNOWN_MODEL | 400 | Model ID doesn't match any aura | OpenAI-compatible error |
| ALL_FALLBACKS_EXHAUSTED | 503 | Every model in the fallback chain failed | OpenAI-compatible error |
| UPSTREAM_ERROR | 502 | Bifrost returns non-2xx for all fallbacks | OpenAI-compatible error |
| PAYLOAD_TOO_LARGE | 413 | Body exceeds 2MB limit | Simple JSON error |
| INTERNAL_ERROR | 500 | Unexpected crash, DB failure | OpenAI-compatible error |

### Logging

- All requests logged to SQLite with timestamp, aura, model, status, latency
- Errors include error_message field with the failure reason
- Console logging for startup, shutdown, and critical failures only (no per-request console noise)


## Performance Considerations

- **Expected load**: Local-only, single user (1-5 concurrent requests)
- **Caching**: Aura config loaded from disk at startup, hot-reloaded on POST /api/auras
- **Streaming**: SSE from Bifrost is re-streamed directly (no buffering in aurora-provider)
- **DB**: SQLite WAL mode for concurrent reads. Indexed on timestamp, aura, status
- **Latency**: Sub-millisecond overhead added by aurora-provider (proxying only). Actual latency driven by Bifrost + upstream providers

## Security Considerations

- [ ] **No secrets stored** -- all API keys live in Bifrost's config, not aurora-provider
- [ ] **Local-only binding** -- server binds to 127.0.0.1 by default, not exposed to network
- [ ] **Input validation** -- model ID format validated, body size limited (2MB)
- [ ] **SQL injection** -- all queries use prepared statements (bun:sqlite)
- [ ] **CORS** -- wide-open CORS (local-only, acceptable)
- [ ] **No PII in logs** -- prompt content removed from usage logs

## Migration Plan

### Phase 1: Repository Setup
1. Create dev branch from main (already done)
2. Create arch/aurora-provider-refactor branch from dev (already done)
3. Commit this design document to docs/design/aurora-provider-refactor.md

### Phase 2: Build New Structure (Parallelizable)
1. Create directory structure (routes/, services/, engine/, db/)
2. Write src/db/schema.js -- database init + migration
3. Write src/services/usage-logger.js -- simplified usage logging
4. Write src/services/config.js -- config file I/O
5. Write src/engine/aura-engine.js -- core dispatch (the only "smart" component)
6. Write src/routes/completions.js -- completions + models endpoints
7. Write src/routes/health.js, src/routes/api/auras.js, src/routes/api/usage.js, src/routes/api/settings.js
8. Write src/app.js -- app factory
9. Write src/index.js -- entry point
10. Update package.json -- remove unused deps, update version to 2.0.0

### Phase 3: Dashboard Refactor
1. Update src/public/index.html -- remove obsolete tabs (Keys, Proxies, Provider Config, Supported Providers)
2. Update src/public/index.js -- remove handler code for removed endpoints
3. Update src/public/index.css -- cleanup

### Phase 4: Cleanup and Migration
1. Delete src/server.js (old monolith)
2. Remove vault/active_proxies.json, vault/model_settings.json (no longer needed)
3. Run database migration (schema.js handles on boot)
4. Update .gitignore for new structure
5. Delete any scratch/fix/test files in project root
6. Remove website/ directory if exists

### Phase 5: Verification
1. Start server, verify health endpoint returns {"status":"ok"}
2. Test /v1/models returns aura list
3. Test non-streaming completion (POST /v1/chat/completions)
4. Test streaming completion (POST /v1/chat/completions with "stream": true)
5. Test unknown model returns 400
6. Test dashboard loads at GET /
7. Test usage logs populate after requests
8. Update vault/auras.json via POST /api/auras, verify persistence

## Trade-offs Log

| Decision | Alternative | Why Chosen |
|----------|-------------|------------|
| Three-layer architecture (routes -> services -> engine) | Flat structure like current monolith | Testability, maintainability, single-responsibility. Each layer can be tested independently. Route handlers don't know about DB internals. |
| Proxying to Bifrost for every request | Embedding Bifrost logic or provider SDKs natively | Keeps aurora-provider as a pure router. Bifrost handles all the complexity of provider selection, key management, rate limits. No duplication of logic. |
| SQLite for usage logging only | Full metrics stack (Prometheus, Grafana) | Overkill for single-user local deployment. SQLite is zero-dependency and already present. Data is queryable via REST API. |
| Removing prompt/response from usage logs | Keeping them for debugging | PII concern -- prompts may contain sensitive data. Combined with local-only deployment, the risk is low but the benefit of logging full prompts is even lower. Usage stats (tokens, latency, status) are sufficient. |
| Fire-and-forget usage logging | Synchronous logging before responding | Adds latency to every request. Fire-and-forget means the response is sent immediately and the log write happens in the background. On failure, the log is silently dropped -- acceptable for usage statistics. |
| Single file per module (not a framework) | Nest.js, AdonisJS, etc. | Project is small (~5 routes, ~3 services). A framework would add more boilerplate than it saves. Hono + vanilla JS modules is the minimum viable structure. |
| No per-fallback retry | Retry each fallback 3x before moving to next | Bifrost already handles retries per provider. Additional retries here would multiply latency. The fallback chain itself is the retry mechanism. |
| Aura name as model ID suffix (aurora-provider/<aura>) | Custom header or separate endpoint | OpenAI-compatible by default. Client sends a standard model ID, server maps it to the aura. No client-side changes needed vs. standard API. |
| Removing SSE log broadcast | Keeping the console.log wrapper | Adds complexity (client tracking, cleanup) for minimal benefit. Dashboard can poll /api/usage instead. Reduces startup time and eliminates a class of memory leak. |
| No file watcher for aura config | Auto-reload on file change | Overkill for single-user local deployment. POST /api/auras is the explicit reload mechanism. |

## Open Questions

- [ ] Should the server support batch completions for multi-model requests? (Assumption: No -- Bifrost can handle this if needed)
- [x] Default port: 10550 (Bifrost's own port — keeps aurora-provider on the same port as the gateway, avoids conflicts with other local services)
- [ ] Should there be a way to hot-reload aura config without a POST? (Assumption: File watcher is overkill -- POST /api/auras is the mechanism)
- [ ] Dashboard theme picker -- keep it? (Assumption: Yes, it's cosmetic and the user may like it)
- [ ] Do we need the /api/logs-stream SSE endpoint for real-time log updates? (Assumption: No -- dashboard can poll)

## Completion Checklist

- [x] Every acceptance criterion from the CTO's task context is addressed
- [x] All API endpoints are fully specified
- [x] Data model changes include table DDL and migration order
- [x] Component impact lists exact file paths for every changed component
- [x] Security considerations checked
- [x] Trade-offs log has 10 entries explaining key decisions
- [x] Open questions are explicitly called out
- [x] The description is implementable by Senior SWE without asking for clarification

