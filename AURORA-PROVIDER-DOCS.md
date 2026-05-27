# Aurora-Provider — Complete Documentation

> **Aurora-Provider** is a self-hosted OpenAI-compatible LLM router that multiplexes requests across multiple AI providers, manages API key rotation, routes traffic through SOCKS5 proxies, and provides a full-featured analytics dashboard.

---

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Request Lifecycle Flow](#2-request-lifecycle-flow)
3. [Core Entities](#3-core-entities)
4. [Dashboard Tab — Analytics & Usage](#4-dashboard-tab--analytics--usage)
5. [API Tester Tab](#5-api-tester-tab)
6. [Agents Config Tab](#6-agents-config-tab)
7. [API Keys & Health Tab](#7-api-keys--health-tab)
8. [Proxy Pool Tab](#8-proxy-pool-tab)
9. [Live Logs Tab](#9-live-logs-tab)
10. [Provider Config Tab](#10-provider-config-tab)
11. [Vault Folder — Data Persistence](#11-vault-folder--data-persistence)
12. [Tracking & Analytics Mechanisms](#12-tracking--analytics-mechanisms)
13. [Theme System](#13-theme-system)
14. [API Reference](#14-api-reference)

---

## 1. Overview & Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Aurora-Provider                              │
│                  (OpenAI-compatible LLM Router)                     │
│                                                                     │
│  ┌────────────┐    ┌──────────────────────────────────────────┐    │
│  │  Dashboard │    │              server.js                    │    │
│  │  (browser) │◄──►│  Express HTTP Server (port 8550)          │    │
│  └────────────┘    │  - Serves static dashboard UI             │    │
│                    │  - /v1/chat/completions (OpenAI compat)   │    │
│  ┌────────────┐    │  - REST APIs: config, usage, proxies      │    │
│  │  OpenCode  │───►│  - SSE: /api/logs-stream                  │    │
│  │  or any    │    └──────────────┬───────────────────────────┘    │
│  │  OpenAI    │                   │                                 │
│  │  client    │              dispatch()                             │
│  └────────────┘                   │                                 │
│                    ┌──────────────▼───────────────────────────┐    │
│                    │           Agent Fallback Chain            │    │
│                    │  Agent config → try provider[0] → ...    │    │
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
│                    │  OpenRouter · OpenCode · Cloudflare AI    │    │
│                    │  SambaNova · DeepInfra · Groq · etc.     │    │
│                    └──────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    vault/                                    │  │
│  │   vault.db (SQLite)  keys.json  agents.json  providers.json │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Characteristics:**
- Single-file Node.js server (`src/server.js`) running under **Bun** runtime
- Fully **stateless HTTP API** — clients use standard OpenAI SDK/curl
- **Multi-provider fallback** — never returns an error if at least one provider has a live key
- **Proxy-first** — all outbound requests go through a SOCKS5 proxy pool to bypass IP-level rate limits
- **Persistent analytics** — every request (success or failure) is stored in SQLite

---

## 2. Request Lifecycle Flow

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
                    │ Resolve Agent  │   model="aurora-provider/coder"
                    │                │   → agentName = "coder"
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │  dispatch()    │   Load agent.fallbacks chain
                    │  Fallback Loop │   e.g. [openrouter, opencode, cloudflare]
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
                    │ usage_logs     │   agent, provider, model, key,
                    │                │   proxy, tokens, latency, source
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ Auto-Refill    │   If PROXY_POOL.length < 50:
                    │ Proxy Pool     │   trigger refreshProxyPool() background
                    └────────────────┘

     PROXY POOL LIFECYCLE:
     ┌─────────────────────────────────────────────────────┐
     │  refreshProxyPool() (runs on startup + auto-refill) │
     │                                                     │
     │  1. Fetch proxy lists from 10 GitHub sources        │
     │  2. Deduplicate → sample 800 proxies                │
     │  3. Batch test (30 concurrent) with 3s timeout      │
     │  4. Filter proxies < latencyThreshold (default 1.5s)│
     │  5. Sort by latency ASC → keep top 100              │
     │  6. Track source stats (success/failure/latency)    │
     └─────────────────────────────────────────────────────┘
```

---

## 3. Core Entities

### Agent

An **Agent** is a named virtual model that maps to an ordered fallback chain of real providers and models.

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
| `agent` | TEXT | Agent name (e.g. `coder`) |
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

## 4. Dashboard Tab — Analytics & Usage

The Dashboard is the primary analytics view. **All metrics and charts are controlled by the Global Filters** at the top.

### Global Filters

| Filter | Description |
|--------|-------------|
| Start Date | Lower bound on `timestamp` |
| End Date | Upper bound on `timestamp` |
| Agent | Filter by agent name |
| Provider | Filter by LLM provider |
| Request Host | Filter by client IP/hostname |
| Source | `API` / `Testing` / specific hostname |
| Status | `Success` / `Error` / All |

Click **Apply Filters** to refresh all KPIs, charts, and the log table simultaneously.

### KPI Cards

- **Total Requests** — Count of all matching log entries
- **Success Rate** — `successCount / totalCount × 100%`
- **Avg Latency** — Average `latency_ms` across successful requests
- **Total Tokens** — Sum of `total_tokens` across all matching records

### Charts

- **Requests Over Time** — Line chart grouping requests by calendar date (`GROUP BY date(timestamp)`)
- **Provider Distribution** — Doughnut chart showing request share by provider

### Usage Request Logs Table

Paginated table (15 rows/page) showing all matching records with columns:

`Timestamp | Request Host | Source | Agent | Provider | Model | Tokens | Key | Proxy | Status | Latency | Details`

- **Details** button opens a modal with full prompt and response text
- Pagination is server-side with `LIMIT/OFFSET` SQL

---

## 5. API Tester Tab

Allows testing any configured agent directly from the browser:

- Select an agent from the dropdown
- Type a prompt
- Toggle streaming on/off
- Click **Run Test** — sends `POST /v1/chat/completions` with `X-Request-Source: Testing`
- Response renders in the JSON viewer (streaming or full JSON)

> Testing requests are marked with `source = "Testing"` in usage logs and can be filtered on the Dashboard.

---

## 6. Agents Config Tab

Manage the fallback chains for all virtual agents:

- **Left panel**: List all agents; click to select
- **Right panel**: Edit the selected agent's fallback chain
  - Drag/reorder fallback steps using ↑↓ arrows
  - Add steps by selecting Provider + Model → **Add Step**
  - Delete individual steps or the entire agent
  - **Save Agents Config** → persists to `vault/agents.json`

> Changes take effect immediately — server reloads config from the in-memory object.

---

## 7. API Keys & Health Tab

### Provider Keys Health (Left Panel)

Live health grid updated every 5 seconds from `/status`:

- **Green dot** = key is available
- **Orange/yellow dot** = key is in cooldown (rate-limited)
- Cooldown timer shown in seconds remaining

### Provider API Keys (Right Panel)

Collapsible cards per provider for key management:

- Keys are displayed as `sk-...***` (first 3 chars visible, rest masked)
- **Copy** button next to each key
- Add multiple keys per provider — each key can have a Name and Email label
- **Save API Keys** → persists to `vault/keys.json`

---

## 8. Proxy Pool Tab

### Configuration (Left Panel)

- **Latency Threshold Slider** (500ms – 5000ms): Only proxies faster than this are kept in the pool
- **Save Threshold** → persists to `vault/settings.json`

### Active Pool Status

- Live pool status: `Idle` | `Scraping...` | `Testing...` | `Active (N proxies)`
- Table of active proxies: URL, latency, success/fail count
- **Refresh Proxies** button → triggers `refreshProxyPool()` in background

### Auto-Refill Logic

The proxy pool automatically refills when:
1. Pool drops below 50% capacity (< 50 of 100 max proxies)
2. Server detects > 1 hour of inactivity on next request
3. **Refresh Proxies** button is clicked

### Proxy Scraper Sources Rankings (Right Panel)

Rankings of the 10 SOCKS5 proxy list URLs by:
- **Success Rate** (% of tested proxies that passed latency filter)
- **Average Speed** (mean latency of successful proxies from that source)

---

## 9. Live Logs Tab

Real-time terminal output streamed via **Server-Sent Events** (SSE) from `/api/logs-stream`:

- All `console.log/warn/error` calls are intercepted and broadcast to connected clients
- Color-coded by level: blue (system), white (info), yellow (warn), red (error)
- **Clear Terminal** button clears the browser view (does not affect server)

---

## 10. Provider Config Tab

Full CRUD for provider configurations:

- **Left panel**: List all providers; click to select
- **Right panel**: Edit provider details:
  - Display Name, Base URL
  - Auth Header (`Authorization`) and Prefix (`Bearer`)
  - Cooldown Time (seconds for fixed rate-limit cooldown)
  - Description/Notes
  - **Models List**: Add/remove model registrations (ID, alias, name, context window, capabilities)
- **Save Provider Config** → persists to `vault/providers.json`

---

## 11. Vault Folder — Data Persistence

All mutable data lives in `vault/`:

```
vault/
├── vault.db          # SQLite database — usage_logs table
├── keys.json         # API keys per provider
├── agents.json       # Agent definitions and fallback chains
├── providers.json    # Provider catalog, endpoints, models
└── settings.json     # Proxy latency threshold setting
```

> ⚠️ **Never commit `keys.json` to version control.** It contains secret API keys. The `.gitignore` already excludes `vault/keys.json`.

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp    DATETIME DEFAULT (datetime('now', 'localtime')),
  agent        TEXT,
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

## 12. Tracking & Analytics Mechanisms

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

## 13. Theme System

Aurora-Provider supports 5 visual themes selectable from the header dropdown:

| Theme | Character |
|-------|-----------|
| **Deep Space** (default) | Dark indigo/purple with green accents |
| **Light Mode** | Clean white with blue/indigo accents |
| **Cyberpunk** | Black with neon green/pink neon |
| **Aurora** | Deep purple with pink/lavender gradients |
| **Ocean** | Dark navy with cyan/teal accents |

Themes are implemented via CSS custom properties on `[data-theme="..."]` attribute selectors. The selected theme is persisted in `localStorage` as `aurora-theme` and restored on each page load.

---

## 14. API Reference

### OpenAI-Compatible Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | Main inference endpoint (streaming supported) |
| `GET` | `/v1/models` | List all agents as OpenAI model objects |

**Model naming:** Use `aurora-provider/<agent-name>` as the model ID.
Example: `aurora-provider/coder`, `aurora-provider/hermes`

### Dashboard REST APIs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Get all providers, agents, keys |
| `POST` | `/api/keys` | Save API keys |
| `POST` | `/api/agents` | Save agent definitions |
| `POST` | `/api/providers` | Save provider configs |
| `GET` | `/api/usage` | Query usage stats & logs (filterable) |
| `GET` | `/api/proxies` | Get proxy pool status and source rankings |
| `POST` | `/api/proxies/refresh` | Trigger proxy pool refresh |
| `GET` | `/api/settings` | Get proxy latency threshold |
| `POST` | `/api/settings` | Update proxy latency threshold |
| `GET` | `/api/logs-stream` | SSE stream of server logs |
| `GET` | `/status` | Key states and server uptime |
| `GET` | `/health` | Health check (status, version, agents) |

### /api/usage Query Parameters

| Parameter | Description |
|-----------|-------------|
| `startDate` | Filter from date (YYYY-MM-DD) |
| `endDate` | Filter to date (YYYY-MM-DD) |
| `agent` | Exact agent name |
| `provider` | Exact provider name |
| `source` | `Testing`, `API`, or hostname |
| `status` | `Success` or `Error` |
| `host` | Client IP or hostname |
| `page` | Page number (default: 1) |
| `limit` | Results per page (default: 50) |

---

## Running the Server

```bash
# Development (auto-restart on file change)
PORT=8550 bun --watch src/server.js

# Production
PORT=8550 bun src/server.js
```

Dashboard: http://127.0.0.1:8550

---

*Aurora-Provider — Self-hosted multi-provider LLM routing with zero vendor lock-in.*
