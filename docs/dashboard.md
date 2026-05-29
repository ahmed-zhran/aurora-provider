# Dashboard Guide

> Complete guide to all dashboard tabs, analytics, and the theme system.

[← Back to README](../README.md) · [Architecture](architecture.md) · [API Reference](api-reference.md) · [Providers Guide](providers-guide.md)

---

## Table of Contents

- [Analytics & Usage Tab](#analytics--usage-tab)
  - [Global Filters](#global-filters)
  - [KPI Cards](#kpi-cards)
  - [Charts](#charts)
  - [Usage Request Logs Table](#usage-request-logs-table)
- [API Tester Tab](#api-tester-tab)
- [Agents Config Tab](#agents-config-tab)
- [API Keys & Health Tab](#api-keys--health-tab)
  - [Provider Keys Health (Left Panel)](#provider-keys-health-left-panel)
  - [Provider API Keys (Right Panel)](#provider-api-keys-right-panel)
- [Proxy Pool Tab](#proxy-pool-tab)
  - [Configuration (Left Panel)](#configuration-left-panel)
  - [Active Pool Status](#active-pool-status)
  - [Auto-Refill Logic](#auto-refill-logic)
  - [Proxy Scraper Sources Rankings (Right Panel)](#proxy-scraper-sources-rankings-right-panel)
- [Live Logs Tab](#live-logs-tab)
- [Provider Config Tab](#provider-config-tab)
- [Theme System](#theme-system)

---

## Analytics & Usage Tab

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

## API Tester Tab

Allows testing any configured agent directly from the browser:

- Select an agent from the dropdown
- Type a prompt
- Toggle streaming on/off
- Click **Run Test** — sends `POST /v1/chat/completions` with `X-Request-Source: Testing`
- Response renders in the JSON viewer (streaming or full JSON)

> **Note:** Testing requests are marked with `source = "Testing"` in usage logs and can be filtered on the Dashboard.

---

## Agents Config Tab

Manage the fallback chains for all virtual agents:

- **Left panel**: List all agents; click to select
- **Right panel**: Edit the selected agent's fallback chain
  - Drag/reorder fallback steps using ↑↓ arrows
  - Add steps by selecting Provider + Model → **Add Step**
  - Delete individual steps or the entire agent
  - **Save Agents Config** → persists to `vault/agents.json`

> **Note:** Changes take effect immediately — server reloads config from the in-memory object.

---

## API Keys & Health Tab

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

## Proxy Pool Tab

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

## Live Logs Tab

Real-time terminal output streamed via **Server-Sent Events** (SSE) from `/api/logs-stream`:

- All `console.log/warn/error` calls are intercepted and broadcast to connected clients
- Color-coded by level: blue (system), white (info), yellow (warn), red (error)
- **Clear Terminal** button clears the browser view (does not affect server)

---

## Provider Config Tab

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

## Theme System

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

*Aurora-Provider — Self-hosted multi-provider LLM routing with zero vendor lock-in.*
