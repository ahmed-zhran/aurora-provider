<p align="center">
  <h1 align="center">Aurora-Provider v2</h1>
  <p align="center">
    <strong>A lean, self-hosted OpenAI-compatible aura router for the Bifrost AI Gateway.</strong>
  </p>
  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
    <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f472b6.svg" alt="Bun"></a>
    <a href="https://github.com/ahmed-zhran/aurora-provider"><img src="https://img.shields.io/github/stars/ahmed-zhran/aurora-provider?style=social" alt="GitHub stars"></a>
  </p>
</p>

---

Aurora-Provider is a **lean, self-hosted aura router** that sits between your AI coding tools (Cursor, Continue, Claude Code, etc.) and the [Bifrost AI Gateway](https://github.com/ahmed-zhran/bifrost). It provides:

- **OpenAI-compatible endpoint** (`/v1/chat/completions`) - drop-in replacement for any OpenAI SDK
- **Aura-based fallback chains** - define virtual models with ordered fallback steps routed through Bifrost
- **Usage tracking** - request logs with latency and error analytics in SQLite
- **Lightweight dashboard** - aura management, API tester, and usage analytics

> **Architecture note:** v2 is a refactored, simplified version. All provider/key/proxy management has been removed in favor of the Bifrost AI Gateway. Aurora-Provider focuses solely on aura routing and usage logging.

---

## Quick Start

```bash
# Prerequisites
bun >= 1.0           # Runtime
Bifrost Gateway      # Running on localhost:10550 (see Bifrost docs)

# 1. Clone
git clone https://github.com/ahmed-zhran/aurora-provider.git
cd aurora-provider

# 2. Install dependencies
bun install

# 3. Configure auras
# Edit vault/auras.json with your aura definitions

# 4. Start the server
bun run start         # or: npm start
# Default port: 8550  (override with PORT env var)
```

You should see:

```
  Aurora-Provider v2 (Hono on Bun)
  Listening: http://127.0.0.1:8550
  Auras:     seolla-nyx-aura
```

- **Dashboard UI**: [http://127.0.0.1:8550](http://127.0.0.1:8550)
- **OpenAI-Compatible Endpoint**: `http://127.0.0.1:8550/v1`

---

## How It Works

```
Cursor / Continue / Cline / Claude Code / Any OpenAI Client
  |
  |  POST /v1/chat/completions
  |  model: "aurora-provider/seolla-nyx-aura"
  v
+-------------------------------------------------------+
|                 Aurora-Provider v2                      |
|                                                         |
|  1. Resolve model name -> Aura ("seolla-nyx-aura")      |
|  2. Load fallback chain from vault/auras.json            |
|  3. For each fallback step (provider, model):           |
|     a. Forward request to Bifrost                       |
|     b. On success -> return response                    |
|     c. On failure -> log error, try next step            |
|  4. All steps exhausted -> 503 ALL_FALLBACKS_EXHAUSTED  |
|                                                         |
|  Background: log usage to SQLite (vault/vault.db)       |
+-------------------------------------------------------+
  |
  +-- Bifrost AI Gateway (:10550)
       |
       +-- API key management & rotation
       +-- Provider fallback per model
       +-- Rate-limit handling & cooldown
       +-- Proxy routing (if configured)
```

### Key Difference vs v1

In v1, Aurora-Provider managed everything: multiple providers, API keys, proxy pools, rate limits, and health probes. In v2, **Bifrost handles all of that** - Aurora-Provider is a lightweight router that delegates inference to Bifrost while adding aura-level fallback orchestration and usage tracking.

---

## Dashboard

Aurora-Provider includes a browser dashboard with three tabs:

- **Dashboard** - KPI cards (total requests, success rate, avg latency), request-over-time chart, and paginated usage logs with filters
- **Auras** - View and manage aura definitions: create, rename, delete, and reorder fallback chains
- **API Tester** - Test any aura directly from the browser with streaming support

Available at [http://127.0.0.1:8550](http://127.0.0.1:8550).

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `8550`  | HTTP server port (binds to 127.0.0.1 only) |

### Vault Files

All persistent configuration lives under the `vault/` directory:

#### Aura Definitions (`vault/auras.json`)

Define virtual models with ordered fallback chains. Each aura exposes an OpenAI-compatible model ID (`aurora-provider/<aura-name>`).

```json
{
  "_comment": "Aurora-Provider aura definitions.",
  "_version": "2.0.0",
  "auras": {
    "seolla-nyx-aura": {
      "fallbacks": [
        { "provider": "bifrost", "model": "opencode-zen/big-pickle", "contextWindow": 200000, "reasoning": true },
        { "provider": "bifrost", "model": "mistral/mistral-medium-3-5", "contextWindow": 262144 },
        { "provider": "bifrost", "model": "openrouter/openrouter/owl-alpha", "contextWindow": 1048576, "reasoning": true }
      ]
    }
  }
}
```

Each fallback step:
- `provider` - always `"bifrost"` (the sole upstream)
- `model` - model ID as known to Bifrost (e.g. `opencode-zen/big-pickle`)
- `contextWindow` - optional, for display/reference
- `reasoning` - optional boolean, marks steps that support reasoning

#### Settings (`vault/settings.json`)

```json
{
  "latencyThreshold": 100,
  "enableProxy": false
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `latencyThreshold` | number | `100` | Latency threshold (ms), informational only |
| `enableProxy` | boolean | `false` | Proxy enable flag, informational only |

---

## Integration Examples

### Cursor (Settings -> Models)

1. Turn off all default models
2. Under **Override OpenAI Base URL**, enter: `http://127.0.0.1:8550/v1`
3. Enter any random string for the API key
4. Add your aura name (e.g. `aurora-provider/seolla-nyx-aura`) as a new model

### Continue (`.continue/config.json`)

```json
{
  "models": [{
    "title": "Aurora",
    "provider": "openai",
    "model": "aurora-provider/seolla-nyx-aura",
    "apiBase": "http://127.0.0.1:8550/v1"
  }]
}
```

### Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8550/v1",
    api_key="aurora-local"  # required by SDK, value is ignored
)

response = client.chat.completions.create(
    model="aurora-provider/seolla-nyx-aura",
    messages=[{"role": "user", "content": "Explain binary search."}]
)
print(response.choices[0].message.content)
```

---

## Project Structure

```
aurora-provider/
+-- src/
|   +-- server.py                 # Entry point - Hono app on Bun
|   +-- routes/
|   |   +-- chat.py               # POST /v1/chat/completions, GET /v1/models
|   |   +-- health.py             # GET /api/health
|   |   +-- auras.py              # CRUD for aura definitions
|   |   +-- logs.py               # Usage log queries + clear
|   |   +-- settings.py           # Settings get/update
|   |   +-- ui.py                 # Static dashboard file serving
|   +-- services/
|   |   +-- aura-service.py       # Aura config read/write
|   |   +-- log-service.py        # Usage logging wrapper
|   |   +-- settings-service.py   # Settings read/write
|   +-- lib/
|   |   +-- aura-engine.py        # Core fallback dispatch engine
|   |   +-- config.py             # JSON file load/save helper
|   |   +-- db.py                 # SQLite database + queries
|   +-- public/
|       +-- index.html            # Dashboard HTML
|       +-- index.js              # Dashboard JavaScript
|       +-- index.css             # Dashboard styles
+-- vault/
|   +-- auras.json                # Aura definitions
|   +-- settings.json             # Server settings
|   +-- vault.db                  # SQLite usage logs
|   +-- .gitkeep
+-- docs/
|   +-- api-reference.md          # API endpoint reference
|   +-- architecture.md           # System architecture
|   +-- setup-guide.md            # Installation & configuration guide
|   +-- migration-notes.md        # v1 -> v2 breaking changes
+-- tests/
|   +-- aura-engine.test.js       # Unit tests for aura engine
|   +-- routes.test.js            # Route tests
|   +-- ...
+-- README.md
+-- CHANGELOG.md
```

---

## API Overview

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | Chat completion (streaming supported) |
| `GET`  | `/v1/models` | List auras as model IDs |
| `GET`  | `/api/health` | Health check with Bifrost connectivity |
| `GET`  | `/api/auras` | List aura definitions |
| `POST` | `/api/auras` | Create or update an aura |
| `DELETE` | `/api/auras/:name` | Delete an aura |
| `GET`  | `/api/logs` | Query usage logs with filters |
| `POST` | `/api/logs/clear` | Clear usage logs |
| `GET`  | `/api/settings` | Get settings |
| `PUT`  | `/api/settings` | Update settings |

See [API Reference](docs/api-reference.md) for full documentation with request/response examples.

---

## Documentation

- [API Reference](docs/api-reference.md) - Complete endpoint specifications
- [Architecture](docs/architecture.md) - System design and request lifecycle
- [Setup Guide](docs/setup-guide.md) - Installation and configuration
- [Migration Notes](docs/migration-notes.md) - v1 -> v2 breaking changes

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the [MIT License](LICENSE).
