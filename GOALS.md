# Project Goals — Aurora-Provider

> This document enumerates the goals of the Aurora-Provider repository, derived
> from a direct analysis of its source code, configuration, tests, and existing
> documentation. Each goal cites the concrete evidence in the repo that it is
> traced to, so a reviewer can verify that the goals are analyzed rather than
> assumed.

---

## Primary Purpose

**Aurora-Provider is a lean, self-hosted, OpenAI-compatible HTTP router that exposes user-defined "auras" (virtual models with ordered fallback chains) and forwards each chat request to a local [Bifrost AI Gateway](https://github.com/ahmed-zhran/bifrost), trying each fallback step in turn until one succeeds — while recording every request to SQLite for usage analytics.**

Evidence:
- `package.json:3` — `"description": "Local OpenAI-compatible LLM router with intelligent multi-provider fallback chains — one endpoint, unlimited free LLMs, zero rate limits"`.
- `README.md:15` — "a **lean, self-hosted aura router** that sits between your AI coding tools … and the Bifrost AI Gateway."
- `src/lib/aura-engine.js:20-68` — `executeAura()` iterates an aura's `fallbacks` list and calls each via Bifrost until one returns `response.ok`.
- `docs/architecture.md` — "The core principle is **separation of concerns**": Aurora-Provider owns the OpenAI API, aura definitions, and analytics; Bifrost owns keys, provider routing, rate limits, and proxies.

---

## Goals

### G1 — Present a drop-in OpenAI-compatible API surface
Expose `POST /v1/chat/completions` and `GET /v1/models` so any OpenAI SDK or AI
coding tool (Cursor, Continue, Cline, Claude Code) can point at Aurora-Provider
with no code changes.

- Evidence: `src/server.js:75` (`app.post('/v1/chat/completions', chat)`),
  `src/server.js:78-86` (`/v1/models` returns auras as model IDs),
  `src/routes/chat.js:10-92` (OpenAI-compatible request/response handling),
  `README.md:163-200` (Cursor / Continue / Python SDK integration examples).

### G2 — Route requests through user-defined auras with ordered fallback chains
Resolve an incoming `model` name to an aura, then attempt each configured
fallback step `(provider, model)` in order until one succeeds; return
`503 ALL_FALLBACKS_EXHAUSTED` only when every step fails.

- Evidence: `src/lib/aura-engine.js:20-68` (fallback loop + exhaustion error),
  `src/routes/chat.js:24-49` (aura resolution + 503 on exhaustion),
  `vault/auras.json` and `README.md:121-146` (aura/fallback config schema).

### G3 — Delegate all provider, key, proxy, and rate-limit concerns to Bifrost
Keep Aurora-Provider deliberately thin: it holds no API keys, no proxy pool, and
no provider-specific logic. Every upstream call goes to a single Bifrost endpoint.

- Evidence: `src/lib/aura-engine.js:8` (`BIFROST_URL = 'http://localhost:10550/v1/chat/completions'` — the sole upstream),
  `docs/architecture.md` responsibility table (keys/routing/rate-limits/proxy → Bifrost),
  `docs/design/aurora-provider-refactor.md` ("What Is Removed" — ~1,420 lines of proxy/key/provider code removed),
  `CHANGELOG.md` `[2.0.0]` "Removed" section.

### G4 — Track usage and expose analytics
Record each request (aura, model, status, latency, error) to a local SQLite
database and expose queryable logs and aggregate stats (success rate, average
latency, per-aura/per-model counts, time series).

- Evidence: `src/lib/db.js:19-27` (`usage_logs` schema),
  `src/lib/db.js:66-134` (`queryLogs`, `getLogStats`, `getAuraUsage`),
  `src/services/log-service.js`, `src/routes/logs.js` (`GET /api/logs`, `POST /api/logs/clear`).

### G5 — Provide a lightweight management dashboard
Ship a zero-build browser UI with three tabs — Dashboard (KPIs, request chart,
paginated logs), Auras (create/rename/delete/reorder fallback chains), and API
Tester (test any aura with streaming) — served directly from the app.

- Evidence: `src/public/index.html`, `src/public/index.js`, `src/public/index.css`,
  `src/routes/ui.js` (static file serving), `README.md:97-105` (three-tab dashboard),
  `docs/design/aurora-provider-refactor-ux.md`.

### G6 — Offer full CRUD management of auras and settings over HTTP
Let auras and settings be managed at runtime via a REST API in addition to the
dashboard.

- Evidence: `src/routes/auras.js` + `src/server.js:58-61`
  (`GET/POST /api/auras`, `DELETE /api/auras/:name`),
  `src/routes/settings.js` + `src/server.js:69-71` (`GET`/`PUT /api/settings`),
  `src/services/aura-service.js`, `src/services/settings-service.js`.

### G7 — Support streaming responses
Pass through Server-Sent Event streams from Bifrost so token-by-token streaming
works end-to-end for compatible clients.

- Evidence: `src/routes/chat.js:67-78` (streams `response.body` chunks via
  Hono's `stream()` when `stream:true` or `text/event-stream`),
  `README.md:100-104` ("API Tester … with streaming support").

### G8 — Run locally and safely by default
Bind only to `127.0.0.1`, cap request body size, enable CORS/compression, and
use parameterized SQL everywhere to avoid injection — a local-first, security-
conscious posture.

- Evidence: `src/server.js:93` (`hostname: '127.0.0.1'`),
  `src/server.js:43-45` (CORS, compress, 2 MB body limit),
  `src/lib/db.js:48-63` (prepared/parameterized statements),
  `CHANGELOG.md` `[2.0.0]` Fixed ("All queries use prepared statements").

### G9 — Stay portable across Bun and Node.js
Run on the Bun runtime (native `Bun.serve`, `bun:sqlite`) while remaining
Node-compatible (`engines.node >= 18`), and verify both in CI.

- Evidence: `package.json:11-13` (`start`/`dev` via Bun), `package.json:51-53`
  (`engines.node >= 18`), `.github/workflows/ci.yml` (matrix `runtime: [bun, node]`).

### G10 — Be well-documented and contribution-ready
Provide operator- and contributor-facing documentation and standard OSS project
scaffolding.

- Evidence: `docs/` (`api-reference.md`, `architecture.md`, `setup-guide.md`,
  `migration-notes.md`, `design/`), `README.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `LICENSE` (MIT), `.github/ISSUE_TEMPLATE/`,
  `.github/PULL_REQUEST_TEMPLATE.md`.

### G11 — Maintain a tested aura engine and API
Keep the core routing logic and API endpoints covered by a layered test suite.

- Evidence: `tests/aura-engine.test.js`, `tests/aura-engine-l5.test.js`,
  `tests/l3-api.test.js`, `tests/l4-integration.test.js`, `tests/routes.test.js`,
  `tests/config.test.js`, `tests/db.test.js`, `tests/aura-service.test.js`,
  `tests/TEST-PLAN.md`, `tests/fixtures/`.

---

## Non-Goals (scope boundaries, from the v2 refactor)

Explicitly out of scope for this repository — these responsibilities were
removed in v2 and delegated to Bifrost:

- API key storage, rotation, cooldown, and health probes.
- SOCKS5/HTTP proxy pool harvesting, testing, and rotation.
- Direct multi-provider connections (Google AI Studio, Groq, OpenRouter, etc.).
- Rate-limit handling and exponential backoff.

Evidence: `CHANGELOG.md` `[2.0.0]` "Removed", `docs/migration-notes.md`,
`docs/design/aurora-provider-refactor.md` ("What Is Removed").

---

## Observations worth flagging (repo hygiene, not goals)

Surfaced during analysis so the maintainer is aware before further work begins:

1. **README file-extension mismatch.** `README.md:206-245` documents the source
   tree with `.py` extensions (`server.py`, `chat.py`, `aura-engine.py`, …), but
   the actual implementation is JavaScript (`src/server.js`, `src/routes/chat.js`,
   `src/lib/aura-engine.js`, …). The docs should be corrected to `.js`.
2. **Stale CI workflow.** `.github/workflows/ci.yml` still references v1 artifacts:
   it copies `vault/keys.example.json` (no longer present) and smoke-tests port
   `9001` and `/health`, whereas v2 uses port `8550` and `/api/health`
   (`src/server.js:55,89`). CI would fail against the current code.
3. **No lint/typecheck scripts.** `package.json` defines only `start`/`dev`; there
   are no `typecheck`, `lint`, or `test` scripts despite a test suite existing.
4. **Loose scratch files at repo root.** Numerous `fix*.py`, `fix_server.js`, and
   `test-*.js`/`test-*.sh` scratch scripts sit at the repo root and appear to be
   development leftovers rather than part of the shipped product.
5. **`settings.json` is documented but not committed.** `README.md:147-160`
   documents `vault/settings.json`, and `src/services/settings-service.js` reads
   it, but only `vault/auras.json` is tracked in the repo.

These are noted for visibility only; addressing them is outside this ticket,
whose sole deliverable is this goals document.
