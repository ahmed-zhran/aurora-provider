# Architecture

> System overview, request lifecycle, and core entities for Aurora-Provider.

[← Back to README](../README.md) · [Dashboard](dashboard.md) · [API Reference](api-reference.md) · [Providers Guide](providers-guide.md)

---

## Table of Contents

- [Overview](#overview)
- [Architecture Diagram](#architecture-diagram)
- [Request Lifecycle Flow](#request-lifecycle-flow)
  - [Proxy Pool Lifecycle (Beta)](#proxy-pool-lifecycle-beta)
- [Core Entities](#core-entities)
  - [Aura](#aura)
  - [Provider](#provider)
  - [API Key](#api-key)
  - [Proxy Entry](#proxy-entry)
  - [Usage Log Record](#usage-log-record)
- [Vault Folder — Data Persistence](#vault-folder--data-persistence)
  - [Database Schema](#database-schema)
- [Tracking & Analytics Mechanisms](#tracking--analytics-mechanisms)
  - [Token Counting](#token-counting)
  - [Source Classification](#source-classification)
  - [Key Health State Machine](#key-health-state-machine)
  - [Proxy Dead Detection](#proxy-dead-detection)
  - [Background Health Probe](#background-health-probe)

---

## Overview

**Aurora-Provider** is a self-hosted OpenAI-compatible LLM router that multiplexes requests across multiple AI providers, manages API key rotation, routes traffic through SOCKS5 proxies, and provides a full-featured analytics dashboard.

**Key Characteristics:**

- Single-file Node.js server (`src/server.js`) running under **Bun** runtime
- Fully **stateless HTTP API** — clients use standard OpenAI SDK/curl
- **Multi-provider fallback** — never returns an error if at least one provider has a live key
- **Proxy-first (Beta)** — all outbound requests go through a SOCKS5 proxy pool to bypass IP-level rate limits
- **Persistent analytics** — every request (success or failure) is stored in SQLite

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Aurora-Provider                              │
│                  (OpenAI-compatible LLM Router)                     │
│                                                                     │
│  ┌────────────┐    ┌──────────────────────────────────────────┐    │
│  │  Dashboard │    │              server.js                    │    │
│  │  (browser) │◄──►│  Express HTTP Server (port 9001)          │    │
│  └────────────┘    │  - Serves static dashboard UI             │    │
│                    │  - /v1/chat/completions (OpenAI compat)   │    │
│  ┌────────────┐    │  - REST APIs: config, usage, proxies      │    │
│  │  Any OpenAI │───►│  - SSE: /api/logs-stream                  │    │
│  │  client    │    └──────────────┬───────────────────────────┘    │
│  │  (Cursor,  │                   │                                 │
│  │  Aider,etc)│              dispatch()                             │
│  └────────────┘                   │                                 │
│                    ┌──────────────▼───────────────────────────┐    │
│                    │           Aura Fallback Chain            │    │
│                    │  Aura config → try provider[0] → ...     │    │
│                    │  → on failure: try provider[1] → ...     │    │
│                    └──────────────┬───────────────────────────┘    │
│                                   │                                 │
│                    ┌──────────────▼───────────────────────────┐    │
│                    │         attemptRequest()                  │    │
│                    │  - Key rotation (skip rate-limited keys)  │    │
│                    │  - Proxy selection (SOCKS5 pool)          │    │
│                    │  - 3 proxy retry attempts per request     │    │
│                    │  - Dead proxy eviction                    │    │
│                    └──────────────┬───────────────────────────┘    │
│                                   │                                 │
│                    ┌──────────────▼───────────────────────────┐    │
│                    │         LLM Provider APIs                 │    │
│                    │ OpenRouter · OpenCode Zen · Cloudflare AI │    │
│                    │  SambaNova · DeepInfra · Groq · etc.     │    │
│                    └──────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    vault/                                    │  │
│  │   vault.db (SQLite)  keys.json  auras.json   providers.json │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Request Lifecycle Flow

```
Client Request: POST /v1/chat/completions
  { "model": "aurora-provider/coder", "messages": [...], "stream": true }
                            │
                    ┌───────▼────────┐
                    │ Inactivity     │   If server idle > 1hr: trigger
                    │ Check          │   background proxy pool refresh
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ Capture Source │   Extract: origin, IP, custom header
                    │ & Host         │   → source = "Testing"|"API"|hostname
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ Resolve Aura   │   model="aurora-provider/coder"
                    │                │   → auraName = "coder"
                    ├────────────────┤
                    │  dispatch()    │   Load aura.fallbacks chain
                    │  Fallback Loop │   e.g. [openrouter, opencode_zen, cloudflare]
                    └───────┬────────┘
                            │
               ┌────────────▼──────────────────────────────────┐
               │  For each provider in fallback chain:          │
               │                                                │
               │  1. getAvailableKey(provider)                  │
               │     Skip keys in cooldown (rate-limited)       │
               │     Return first available key                  │
               │                                                │
               │  2. getNextProxy()                             │
               │     Rotate through top-10 proxies in pool      │
               │                                                │
               │  3. fetch(providerAPI, { dispatcher: proxy })  │
               │                                                │
               │  On HTTP 429 with proxy:                       │
               │    → removeDeadProxy(proxy) + retry same key   │
               │    → up to 3 proxy retries per key             │
               │    → if all proxy retries fail: markKeyLimited  │
               │                                                │
               │  On HTTP 429 without proxy (key RL):           │
               │    → markKeyLimited(provider, keyIndex)        │
               │    → try next available key                    │
               │    → if all keys exhausted: try next provider  │
               │                                                │
               │  On Network Error (proxy dead):                │
               │    → removeDeadProxy(proxy) + retry            │
               │    → if all retries fail: try next provider    │
               │                                                │
               │  On 502/504/403 (proxy bad):                   │
               │    → removeDeadProxy(proxy) + retry            │
               └────────────┬──────────────────────────────────┘
                            │  SUCCESS
                    ┌───────▼────────┐
                    │ Stream/JSON    │   Pass upstream response to client
                    │ Passthrough    │   Parse tokens from SSE chunks
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ Log to SQLite  │   Insert full request record:
                    │ usage_logs     │   aura, provider, model, key,
                    │                │   proxy, tokens, latency, source
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ Auto-Refill    │   If PROXY_POOL.length < 50:
                    │ Proxy Pool     │   trigger refreshProxyPool() background
                    └────────────────┘
```

### Proxy Pool Lifecycle (Beta)

```
┌─────────────────────────────────────────────────────┐
│  refreshProxyPool() (runs on startup + auto-refill) │
│                                                     │
│  1. Fetch proxy lists from 10 GitHub sources        │
│  2. Deduplicate → sample 800 proxies                │
│  3. Batch test (30 concurrent) with 3s timeout      │
│  4. Filter proxies < latencyThreshold (default 1.5s)│
│  5. Sort by latency ASC → keep top 200              │
│  6. Track source stats (success/failure/latency)    │
└─────────────────────────────────────────────────────┘
```

---

## Core Entities

### Aura

An **Aura** is a named virtual model that maps to an ordered fallback chain of real providers and models.

```json
{
  "coder": {
    "fallbacks": [
      { "provider": "openrouter",  "model": "google/gemma-3-27b-it:free" },
      { "provider": "opencode_zen","model": "Qwen/Qwen3-235B-A22B" },
      { "provider": "cloudflare_workers_ai", "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }
    ]
  }
}
```

- **Name**: Identifier used in model string (`aurora-provider/coder`)
- **Fallbacks**: Ordered list — first entry is tried first; fallback proceeds on failure

### Provider

A **Provider** is an LLM API backend configuration.

```json
{
  "openrouter": {
    "name": "OpenRouter",
    "baseUrl": "https://openrouter.ai/api/v1",
    "authHeader": "Authorization",
    "authPrefix": "Bearer",
    "cooldownTime": 3600,
    "models": [
      {
        "id": "google/gemma-3-27b-it:free",
        "alias": "gemma-3-or",
        "name": "Gemma 3 27B (free)",
        "contextWindow": 131072,
        "reasoning": false,
        "coding": true
      }
    ]
  }
}
```

- **baseUrl**: API endpoint root (without `/chat/completions`)
- **authHeader / authPrefix**: How to format the API key header
- **cooldownTime**: Fixed cooldown in seconds for rate-limited keys (overrides dynamic backoff)
- **models**: List of available model configurations

### API Key

Keys are stored per provider and auto-rotated on rate limits:

```json
{
  "openrouter": [
    { "key": "sk-or-v1-abc...", "name": "Key 1", "email": "user1@example.com" },
    { "key": "sk-or-v1-xyz...", "name": "Key 2", "email": "user2@example.com" }
  ]
}
```

- Multiple keys per provider — automatically cycled when one is rate-limited
- Keys in cooldown are tracked in-memory with `keyState` map
- Cooldown uses exponential backoff: `min(60s × failures, 900s)`
- Every 15 minutes, a background health probe resets and tests all keys

### Proxy Entry

```javascript
{
  url: "socks5://206.123.156.202:4675",
  latency: 342,        // ms measured during testing
  source: "https://raw.githubusercontent.com/.../socks5.txt",
  successCount: 12,    // incremented per successful use
  failureCount: 0      // incremented on eviction
}
```

### Usage Log Record

Every request generates one record in `vault.db`:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `timestamp` | DATETIME | Local time of request |
| `aura` | TEXT | Aura name (e.g. `coder`) |
| `provider` | TEXT | Provider used (e.g. `openrouter`) |
| `model` | TEXT | Exact model ID sent upstream |
| `key_index` | INTEGER | Index of key in provider's key array |
| `key_name` | TEXT | Friendly key name |
| `key_email` | TEXT | Email associated with key |
| `proxy` | TEXT | SOCKS5 proxy URL used (or `direct`) |
| `source` | TEXT | `Testing`, `API`, or origin hostname |
| `prompt` | TEXT | JSON-serialized messages array |
| `response` | TEXT | Model response text |
| `status` | TEXT | `Success` or `Error` |
| `error_message` | TEXT | Error details on failure |
| `latency_ms` | INTEGER | End-to-end latency in milliseconds |
| `prompt_tokens` | INTEGER | Input token count (from API or estimated) |
| `completion_tokens` | INTEGER | Output token count |
| `total_tokens` | INTEGER | Sum of prompt + completion tokens |
| `request_host` | TEXT | IP or hostname of the requesting client |

---

## Vault Folder — Data Persistence

All mutable data lives in `vault/`:

```
vault/
├── vault.db          # SQLite database — usage_logs table
├── keys.json         # API keys per provider
├── auras.json        # Aura definitions and fallback chains
├── providers.json    # Provider catalog, endpoints, models
└── settings.json     # Proxy latency threshold setting
```

> ⚠️ **Never commit `keys.json` to version control.** It contains secret API keys. The `.gitignore` already excludes `vault/keys.json`.

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp    DATETIME DEFAULT (datetime('now', 'localtime')),
  aura         TEXT,
  provider     TEXT,
  model        TEXT,
  key_index    INTEGER,
  key_name     TEXT,
  key_email    TEXT,
  proxy        TEXT,
  source       TEXT,
  prompt       TEXT,
  response     TEXT,
  status       TEXT,
  error_message TEXT,
  latency_ms   INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  request_host TEXT
);
```

---

## Tracking & Analytics Mechanisms

### Token Counting

Token counts are captured in two ways depending on response mode:

**Streaming (SSE):**
- Each SSE chunk is buffered and parsed after the stream ends
- The `usage` object from the final SSE chunk is extracted if present
- If no usage object: tokens are estimated as `text.length / 4`

**JSON (non-streaming):**
- `data.usage.prompt_tokens` and `data.usage.completion_tokens` are read directly from the response
- If absent: prompt tokens estimated from message text length, completion tokens from response length

### Source Classification

```
Request arrives → Check headers:
  1. X-Request-Source: Testing  →  source = "Testing"
  2. Origin / Referer present   →  source = hostname from URL
  3. Neither                    →  source = "API"

request_host = client IP (or "Dashboard" for Testing source)
```

### Key Health State Machine

```
Key State:
  AVAILABLE → (rate limited 429) → COOLING
  COOLING   → (cooldownUntil passed) → AVAILABLE (auto-reset on next check)
  COOLING   → (background probe succeeds) → AVAILABLE (explicit reset)

Cooldown Duration:
  - If provider.cooldownTime defined: use fixed value
  - Otherwise: min(60s × failureCount, 900s)  [max 15 minutes]
```

### Proxy Dead Detection

A proxy is **evicted** (removed from pool) when:
- It returns HTTP 429 (after exhausting per-key retries)
- It returns HTTP 502, 504, or 403
- It throws a network-level error (timeout, connection refused, etc.)

On eviction:
1. `SOURCE_STATS[proxy.source].failure++`
2. Remove from `PROXY_POOL` array
3. If pool < 50% capacity → trigger `refreshProxyPool()` background

### Background Health Probe

Every 15 minutes (`PROBE_INTERVAL_MS`), after an initial 10-second startup delay:
1. Loop through all providers with configured keys
2. For each key: `resetKey()` → `attemptRequest()` with a minimal "Reply OK" test body
3. Log `✓` or `✗` to console
4. Keys that pass are marked available again

---

*Aurora-Provider — Self-hosted multi-provider LLM routing with zero vendor lock-in.*
