# Architecture

> System overview, request lifecycle, and core entities for Aurora-Provider v2.

---

## Overview

**Aurora-Provider v2** is a lean, self-hosted OpenAI-compatible aura router that sits between AI coding tools and the Bifrost AI Gateway. It provides:

- **Aura resolution** -- maps model names to virtual "aura" entities
- **Ordered fallback chains** -- tries each fallback step in sequence until one succeeds
- **Bifrost forwarding** -- all inference requests are delegated to Bifrost
- **Usage logging** -- requests/results are recorded in SQLite for analytics

The core principle is **separation of concerns**:

| Responsibility | Handled By |
|----------------|------------|
| OpenAI-compatible API | Aurora-Provider |
| Aura/fallback definitions | Aurora-Provider |
| Usage analytics and logging | Aurora-Provider |
| Key management and rotation | Bifrost |
| Provider-specific routing | Bifrost |
| Rate-limit handling and cooldown | Bifrost |
| Proxy routing (SOCKS5/HTTP) | Bifrost |

---

## Architecture Diagram

```
+---------------------+         +---------------------+         +-------------------+
|   AI Coding Tools   |  HTTP   |  Aurora-Provider    |  HTTP   |  Bifrost Gateway  |
|                     |-------->|    v2 (aura router)  |-------->|    (:10550)        |
|                     |         |                     |         |                   |
|  - Cursor           |         |  POST /v1/chat/      |         |  POST /v1/chat/   |
|  - Continue         |         |    completions       |         |    completions    |
|  - Claude Code      |         |                     |         |                   |
|  - Cline/Roo Code   |         |  1. Resolve aura     |         |  Bifrost handles: |
|  - Custom (OpenAI   |         |  2. Load fallbacks    |         |  - Key rotation   |
|    SDK)             |         |  3. Try each step    |         |  - Provider auth  |
|                     |         |  4. Return response  |         |  - Rate limits    |
|  (port 8550)        |         |                     |         |  - Proxy routing  |
+---------------------+         +---------+-----------+         +-------------------+
                                          |
                                   +------+------+
                                   |  SQLite DB  |
                                   | vault.db   |
                                   | usage_logs |
                                   +-------------+
```

---

## Request Lifecycle

```
Client: POST /v1/chat/completions
  { "model": "aurora-provider/seolla-nyx-aura", "messages": [...], "stream": true }
                    |
         +----------v-----------+
         | 1. Parse request      |  Validate JSON, extract model
         +----------+-----------+
                    |
         +----------v-----------+
         | 2. Resolve aura       |  model -> aura name ("seolla-nyx-aura")
         +----------+-----------+  Supports "aura-name" and "aurora-provider/aura-name"
                    |
         +----------v-----------+
         | 3. Load fallback      |  Read aura config from in-memory cache
         |    chain              |  (loaded from vault/auras.json at startup)
         +----------+-----------+
                    |
         +----------v-----------+
         | 4. Dispatch loop      |  for each step in fallback chain:
         |                       |
         |    +-- step[0] --------------------+
         |    |  fetch(Bifrost, { model, ... }) |
         |    |  success? -> return response    |
         |    |  failure?  -> log error, continue |
         |    +---------------------------------+
         |                       |
         |    +-- step[1] --------------------+
         |    |  ... (next fallback)           |
         |    +---------------------------------+
         |                       |
         |    All exhausted -> return 503
         +----------+-----------+
                    |
         +----------v-----------+
         | 5. Return response    |  Stream (SSE) or JSON passthrough
         +----------+-----------+
                    |
         +----------v-----------+
         | 6. Log usage          |  Fire-and-forget INSERT to usage_logs
         |    (async)            |  (error if dispatch failed)
         +----------------------+
```

---

## Core Components

### Application Layer (`src/server.js`)

Entry point that:
1. Initializes the SQLite database
2. Creates services (aura, log, settings)
3. Registers all routes on the Hono app
4. Starts the Bun HTTP server (binds to `127.0.0.1`)

Uses Hono.js middleware stack: CORS, compression, 2MB body limit.

### Route Layer (`src/routes/`)

Each file returns route handlers as plain objects (no classes):

| Route | Purpose |
|-------|---------|
| `chat.js` | POST /v1/chat/completions, GET /v1/models |
| `health.js` | GET /api/health |
| `auras.js` | CRUD for aura definitions |
| `logs.js` | Usage log query + clear |
| `settings.js` | Settings get/update |
| `ui.js` | Static dashboard file serving |

### Service Layer (`src/services/`)

Thin wrappers around lib functions:

| Service | Responsibility |
|---------|---------------|
| `aura-service.js` | Read/write aura definitions to `vault/auras.json` |
| `log-service.js` | Wrapper around DB insert/query/clear operations |
| `settings-service.js` | Read/write settings to `vault/settings.json` |

### Library Layer (`src/lib/`)

Core logic:

| Library | Responsibility |
|---------|---------------|
| `aura-engine.js` | Core fallback dispatch -- iterates chain, calls Bifrost, returns on success |
| `config.js` | JSON file load/save helper with graceful error handling |
| `db.js` | SQLite database init, prepared statements, query builder |

---

## Aura Engine

The heart of the system. `executeAura(auraName, body, auras)`:

1. Looks up the aura by name from the loaded config
2. Strips the `model` field from the request body (replaced per-step)
3. Iterates through each fallback step:
   - Constructs a fetch request to Bifrost with the step's model ID
   - Sets a 60-second timeout via `AbortSignal.timeout`
   - On success (2xx), returns immediately with the response, provider, and model
   - On failure, logs a warning and continues to the next step
4. If all steps fail, throws `ALL_FALLBACKS_EXHAUSTED`

**Key characteristics:**
- No retry logic per step -- each fallback is tried once
- No internal key/proxy management -- Bifrost handles that
- Streaming passthrough -- Bifrost's SSE is re-streamed directly
- Timeout: 60 seconds per step

---

## Data Model

### Usage Log Schema

```sql
CREATE TABLE usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT (datetime('now')),
  aura TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'Success',
  latency_ms INTEGER,
  error TEXT
);
```

**Column changes from v1:**

| Old Column | Status | Reason |
|-----------|--------|--------|
| provider | Removed | Always \"bifrost\" now |
| key_index | Removed | No key management |
| key_name | Removed | No key management |
| key_email | Removed | No key management |
| proxy | Removed | No proxy layer |
| prompt | Removed | PII concern |
| response | Removed | PII concern |
| prompt_tokens | Removed | Bifrost doesn't return detailed usage |
| completion_tokens | Removed | Bifrost doesn't return detailed usage |
| total_tokens | Removed | Bifrost doesn't return detailed usage |
| request_host | Removed | Not useful without proxy analytics |
| source | Removed | Only API source now |
| error_message | Renamed | Now `error` (shorter) |

### Vault Config Files

```
vault/
+-- auras.json       Aura definitions with fallback chains
+-- settings.json    Server settings (latencyThreshold, enableProxy)
+-- vault.db         SQLite database (usage logs)
+-- .gitkeep         Ensures vault/ exists in git
```

---

## Error Handling

| Error Type | HTTP Status | When | Response |
|-----------|-------------|------|----------|
| UNKNOWN_MODEL | 400 | Model ID doesn't match any aura | OpenAI-compatible error with available auras |
| NO_FALLBACKS | 400 | Aura exists but has empty fallback chain | OpenAI-compatible error |
| ALL_FALLBACKS_EXHAUSTED | 503 | Every model in the fallback chain failed | OpenAI-compatible error |
| INVALID_JSON | 400 | Request body is not valid JSON | OpenAI-compatible error |
| MISSING_MODEL | 400 | No `model` field in request body | OpenAI-compatible error |
| PAYLOAD_TOO_LARGE | 413 | Body exceeds 2MB limit | Simple JSON error |
| INTERNAL_ERROR | 500 | Unexpected crash or DB failure | OpenAI-compatible error |

---

## Performance

- **Expected load**: Local-only, single user (1-5 concurrent requests)
- **Aura config**: Loaded from disk at startup; hot-reloaded on POST /api/auras
- **Streaming**: SSE from Bifrost is re-streamed directly (no buffering in aurora-provider)
- **DB**: SQLite WAL mode for concurrent reads. Indexed on timestamp, aura, status
- **Overhead**: Sub-millisecond per request (proxying only). Actual latency driven by Bifrost + upstream providers

---

## Security

- **No secrets stored** -- all API keys live in Bifrost, not aurora-provider
- **Local-only binding** -- server binds to `127.0.0.1` by default
- **Input validation** -- model ID format validated, body size limited (2MB)
- **SQL injection** -- all queries use prepared statements (bun:sqlite)
- **CORS** -- wide-open CORS (acceptable for local-only use)
- **No PII in logs** -- prompt/response content not stored

---

*Last updated: 2026-06-21*
