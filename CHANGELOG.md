# Changelog

All notable changes to Aurora-Provider will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-06-21

### Changed (Architecture Rewrite)

- **Complete architecture refactor** — v2 is now a lean aura router that delegates all provider interactions to the Bifrost AI Gateway (instead of managing providers, keys, and proxies internally)
- **Default port changed** from 9001 to 8550
- **API endpoints restructured** — `/api/health` replaces `/health`, `/api/logs` replaces `/api/usage`, settings endpoint changed from POST to PUT
- **Request lifecycle simplified** — model resolution + fallback dispatch through Bifrost, no internal retry/proxy/key logic
- **Dashboard reduced** to 3 tabs (Dashboard, Auras, API Tester) — removed Keys, Proxy, Provider Config, and Live Logs tabs
- **Dependencies cleaned** — removed `https-proxy-agent`, `socks`, `socks-proxy-agent`, `node-fetch`, `undici` (all unused in the new architecture)
- **Runtime upgraded** — Bun native fetch replaces all external HTTP libraries

### Removed

- **SOCKS5 proxy pool** — proxy harvesting, testing, rotation, and source ranking (moved to Bifrost)
- **API key management** — key storage, rotation, cooldown tracking, and health probes (moved to Bifrost)
- **Multi-provider routing** — direct connections to Google AI Studio, Groq, OpenRouter, etc. (now routed through Bifrost)
- **SSE log streaming** (`/api/logs-stream`) — real-time log broadcasting removed
- **Key/Provider config APIs** (`/api/keys`, `/api/providers`, `/api/config`) — all config moved to Bifrost
- **Proxy pool APIs** (`/api/proxies`, `/api/proxies/refresh`) — no proxy layer
- **Rich usage log columns** — simplified to: `id, timestamp, aura, model, status, latency_ms, error`
- **Background health probe** — periodic key health checking every 15 minutes
- **`vault/keys.json`** — API keys now stored exclusively in Bifrost

### Added

- **DELETE /api/auras/:name** — delete individual auras via API
- **Bifrost connectivity check** — `/api/health` reports Bifrost status
- **Documentation** — new docs/ directory with API reference, architecture overview, setup guide, and migration notes

### Fixed

- **All queries use prepared statements** — bun:sqlite parameterized queries throughout (security hardening)

## [1.0.0] - 2026-05-29

### Features

- OpenAI-compatible API server
- Two-layer fallback system (key rotation + provider failover)
- 10+ free LLM providers (Google AI Studio, Groq, Cloudflare Workers AI, OpenRouter, Zhipu, Kimi, Cerebras, NVIDIA NIM, GitHub Models, OpenCode Zen)
- Full analytics dashboard with 5 themes
- SOCKS5 proxy pool with auto-refresh
- Intelligent rate limit handling with exponential backoff
- SQLite usage tracking with full analytics
- Aura-based routing (plan, build, coder, explore, researcher, scribe, reviewer)
- Zero-config providers (unconfigured providers automatically skipped)

