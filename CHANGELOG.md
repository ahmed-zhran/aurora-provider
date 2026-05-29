# Changelog

All notable changes to Aurora-Provider will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-29

### 🎉 Initial Public Release

#### Features
- **OpenAI-compatible API server** — drop-in replacement for any OpenAI client
- **Two-layer fallback system** — key rotation (Layer 1) + provider failover (Layer 2)
- **10+ free LLM providers** — Google AI Studio, Groq, Cloudflare Workers AI, OpenRouter, Zhipu, Kimi, Cerebras, NVIDIA NIM, GitHub Models, OpenCode Zen
- **Full analytics dashboard** with 6 tabs:
  - Dashboard (KPIs, charts, usage logs)
  - API Tester (test any aura from browser)
  - Aura Hub (drag-and-drop fallback chain editor)
  - API Keys & Health (live key status with cooldown timers)
  - Proxy Pool (SOCKS5 proxy management with source rankings)
  - Live Logs (real-time SSE terminal)
  - Provider Config (full CRUD for provider definitions)
- **5 dashboard themes** — Deep Space, Light Mode, Cyberpunk, Aurora, Ocean
- **SOCKS5 proxy pool** — auto-refreshing pool of validated proxies to bypass IP-level rate limits
- **Intelligent rate limit handling** — exponential backoff with background health probes every 15 minutes
- **SQLite usage tracking** — persistent logging of all requests with full analytics
- **Streaming support** — full SSE passthrough for streaming responses
- **Aura-based routing** — Exposes pre-configured fallback models (plan, build, coder, explore, researcher, scribe, reviewer)
- **Zero-config providers** — unconfigured providers are automatically skipped in fallback chains

#### Infrastructure
- Single-file server architecture (Hono framework on Bun/Node.js)
- JSON-based configuration (auras, providers, keys)
- Systemd service file for Linux auto-start

[1.0.0]: https://github.com/ahmed-zhran/aurora-provider/releases/tag/v1.0.0
