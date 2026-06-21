# Setup Guide

> Installation, configuration, and running instructions for Aurora-Provider v2.

---

## Prerequisites

- **Bun** >= 1.0 — JavaScript runtime ([install guide](https://bun.sh/docs/installation))
- **Bifrost AI Gateway** — running on `localhost:10550` (see [Bifrost documentation](https://github.com/ahmed-zhran/bifrost))
- An OpenAI-compatible AI coding tool (Cursor, Continue, Claude Code, etc.)

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/ahmed-zhran/aurora-provider.git
cd aurora-provider
```

### 2. Install dependencies

```bash
bun install
```

This installs:
- `hono` ^4.x — Web framework (middleware stack, routing)
- `marked` ^18.x — Dashboard dependency (future markdown rendering)

All proxy, key management, and multi-provider dependencies from v1 are removed.

### 3. Verify Bifrost is running

```bash
curl http://localhost:10550/api/health
```

Expected response: `{ "status": "ok", ... }`

If Bifrost is not running, start it first. See the [Bifrost setup guide](https://github.com/ahmed-zhran/bifrost) for instructions.

---

## Configuration

### Environment Variables

Aurora-Provider respects a single environment variable:

```bash
# Optional: override the default port
export PORT=8550
```

Default is `8550`. The server binds to `127.0.0.1` only (not network-accessible).

### Vault Directory

All persistent configuration lives in `vault/`. The directory is created automatically on first run if it doesn't exist.

#### Auras (`vault/auras.json`)

Define your virtual models here. Each aura is a named entity with an ordered fallback chain. The server must be restarted (or you can POST to `/api/auras`) for changes to take effect.

See [Configuration in README](../README.md#vault-files) for the full format.

#### Settings (`vault/settings.json`)

```json
{
  "latencyThreshold": 100,
  "enableProxy": false
}
```

Both settings are informational (for use by Bifrost or external tooling) — aurora-provider does not enforce them.

---

## Running

### Development (with auto-reload)

```bash
bun run dev
```

Uses `bun --watch` to restart on file changes.

### Production

```bash
bun run start
```

Or directly:

```bash
bun src/server.js
```

### Startup Output

```
  Aurora-Provider v2 (Hono on Bun)
  Listening: http://127.0.0.1:8550
  Auras:     seolla-nyx-aura
```

---

## Verifying

### Health Check

```bash
curl http://127.0.0.1:8550/api/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "2.0.0",
  "auras": ["seolla-nyx-aura"],
  "bifrost": "connected",
  "bifrostEndpoint": "http://localhost:10550"
}
```

### List Models

```bash
curl http://127.0.0.1:8550/v1/models
```

### Test Chat

```bash
curl http://127.0.0.1:8550/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "aurora-provider/seolla-nyx-aura",
    "messages": [{"role": "user", "content": "Say hello"}]
  }'
```

---

## Dashboard

Open [http://127.0.0.1:8550](http://127.0.0.1:8550) in your browser.

The dashboard has three tabs:

1. **Dashboard** — Usage analytics with KPI cards, time-series chart, and paginated log table with filters
2. **Auras** — Create, rename, delete auras, and reorder fallback chains with up/down arrows
3. **API Tester** — Test any aura with a prompt (streaming or non-streaming)

---

## Integrating with AI Tools

### Cursor

1. Open Settings -> Models
2. Disable all default models
3. Under **Override OpenAI Base URL**, enter `http://127.0.0.1:8550/v1`
4. Enter any string as the API key
5. Add your aura name (e.g. `aurora-provider/seolla-nyx-aura`) as a new model

### Continue

In `.continue/config.json`:
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

### Claude Code

```bash
export CLAUDE_CODE_BASE_URL=http://127.0.0.1:8550/v1
export CLAUDE_CODE_API_KEY=any-string
claude
```

### OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8550/v1",
    api_key="any-string"
)
response = client.chat.completions.create(
    model="aurora-provider/seolla-nyx-aura",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

---

## Troubleshooting

### "Bifrost: unreachable" in health check

- Ensure Bifrost is running: `curl http://localhost:10550/api/health`
- Check port: Bifrost defaults to 10550
- Network: both services must be on the same host

### "Unknown model/aura" error

- Verify the aura name in your request matches an entry in `vault/auras.json`
- Use either `aura-name` or `aurora-provider/aura-name` format
- Check the models list: `curl http://127.0.0.1:8550/v1/models`

### All fallbacks exhausted

- Each fallback step is tried once. If all fail, Bifrost may be down or all Bifrost routes may be unavailable
- Check Bifrost health and logs
- Ensure at least one fallback step references a valid model ID recognized by Bifrost

### Port conflict

- Default port is 8550. Override with `PORT=8551 bun run start`
- Ensure nothing else is listening on port 8550: `ss -tlnp | grep 8550`

---

*Last updated: 2026-06-21*
