# API Reference

> Complete API endpoint reference for Aurora-Provider.

[← Back to README](../README.md) · [Architecture](architecture.md) · [Dashboard](dashboard.md) · [Providers Guide](providers-guide.md)

---

## Table of Contents

- [OpenAI-Compatible Endpoints](#openai-compatible-endpoints)
  - [POST /v1/chat/completions](#post-v1chatcompletions)
  - [GET /v1/models](#get-v1models)
- [Dashboard REST APIs](#dashboard-rest-apis)
  - [GET /api/config](#get-apiconfig)
  - [POST /api/keys](#post-apikeys)
  - [POST /api/auras](#post-apiauras)
  - [POST /api/providers](#post-apiproviders)
  - [GET /api/usage](#get-apiusage)
  - [GET /api/proxies](#get-apiproxies)
  - [POST /api/proxies/refresh](#post-apiproxiesrefresh)
  - [GET /api/settings](#get-apisettings)
  - [POST /api/settings](#post-apisettings)
  - [GET /api/logs-stream](#get-apilogs-stream)
  - [GET /status](#get-status)
  - [GET /health](#get-health)
- [Query Parameters — /api/usage](#query-parameters--apiusage)
- [Examples](#examples)

---

## OpenAI-Compatible Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | Main inference endpoint (streaming supported) |
| `GET` | `/v1/models` | List all auras as OpenAI model objects |

**Model naming:** Use `aurora-provider/<aura-name>` as the model ID.

Examples: `aurora-provider/coder`, `aurora-provider/hermes`, `aurora-provider/build`

---

### POST /v1/chat/completions

The main inference endpoint. Fully compatible with the OpenAI Chat Completions API.

**Request:**

```bash
curl http://127.0.0.1:8550/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer aurora-provider-local" \
  -d '{
    "model": "aurora-provider/coder",
    "messages": [{"role": "user", "content": "Write hello world in Python"}],
    "max_tokens": 200
  }'
```

**Request Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Aura model ID (e.g. `aurora-provider/coder`) |
| `messages` | array | Yes | Array of message objects with `role` and `content` |
| `stream` | boolean | No | Enable SSE streaming (default: `false`) |
| `max_tokens` | integer | No | Maximum tokens in the response |
| `temperature` | number | No | Sampling temperature (0–2) |

**Headers:**

| Header | Description |
|--------|-------------|
| `Authorization` | `Bearer <any-string>` (required by OpenAI SDK, value is ignored) |
| `Content-Type` | `application/json` |
| `X-Request-Source` | Optional — set to `Testing` to mark the request in logs |

**Response (non-streaming):**

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "print('Hello, World!')"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 8,
    "total_tokens": 23
  }
}
```

**Response (streaming):**

When `stream: true`, the response is delivered as Server-Sent Events (SSE). Each chunk follows the OpenAI streaming format:

```
data: {"choices":[{"delta":{"content":"print"},"index":0}]}

data: {"choices":[{"delta":{"content":"('Hello"},"index":0}]}

data: [DONE]
```

---

### GET /v1/models

Lists all configured auras as OpenAI-compatible model objects.

**Request:**

```bash
curl http://127.0.0.1:8550/v1/models
```

**Response:**

```json
{
  "object": "list",
  "data": [
    { "id": "aurora-provider/coder", "object": "model" },
    { "id": "aurora-provider/build", "object": "model" },
    { "id": "aurora-provider/plan", "object": "model" }
  ]
}
```

---

## Dashboard REST APIs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Get all providers, auras, keys |
| `POST` | `/api/keys` | Save API keys |
| `POST` | `/api/auras` | Save aura definitions |
| `POST` | `/api/providers` | Save provider configs |
| `GET` | `/api/usage` | Query usage stats & logs (filterable) |
| `GET` | `/api/proxies` | Get proxy pool (Beta) status and source rankings |
| `POST` | `/api/proxies/refresh` | Trigger proxy pool (Beta) refresh |
| `GET` | `/api/settings` | Get proxy latency threshold |
| `POST` | `/api/settings` | Update proxy latency threshold |
| `GET` | `/api/logs-stream` | SSE stream of server logs |
| `GET` | `/status` | Key states and server uptime |
| `GET` | `/health` | Health check (status, version, auras) |

---

### GET /api/config

Returns all providers, auras, and keys configuration.

```bash
curl http://127.0.0.1:8550/api/config
```

---

### POST /api/keys

Saves API keys for all providers.

```bash
curl -X POST http://127.0.0.1:8550/api/keys \
  -H "Content-Type: application/json" \
  -d '{"keys": {"groq": ["gsk_key1", "gsk_key2"]}}'
```

---

### POST /api/auras

Saves aura definitions and fallback chains.

```bash
curl -X POST http://127.0.0.1:8550/api/auras \
  -H "Content-Type: application/json" \
  -d '{"auras": {"coder": {"fallbacks": [{"provider": "groq", "model": "llama-3.3-70b"}]}}}'
```

---

### POST /api/providers

Saves provider configurations.

```bash
curl -X POST http://127.0.0.1:8550/api/providers \
  -H "Content-Type: application/json" \
  -d '{"groq": {"name": "Groq", "baseUrl": "https://api.groq.com/openai/v1"}}'
```

---

### GET /api/usage

Query usage statistics and logs with filtering and pagination.

```bash
curl "http://127.0.0.1:8550/api/usage?startDate=2026-01-01&aura=coder&status=Success&page=1&limit=50"
```

See [Query Parameters](#query-parameters--apiusage) below for full parameter list.

---

### GET /api/proxies (Beta)

Returns the current proxy pool (Beta) status and source rankings.

```bash
curl http://127.0.0.1:8550/api/proxies
```

---

### POST /api/proxies/refresh (Beta)

Triggers a background proxy pool (Beta) refresh.

```bash
curl -X POST http://127.0.0.1:8550/api/proxies/refresh
```

---

### GET /api/settings

Returns the current proxy latency threshold setting.

```bash
curl http://127.0.0.1:8550/api/settings
```

---

### POST /api/settings

Updates the proxy latency threshold.

```bash
curl -X POST http://127.0.0.1:8550/api/settings \
  -H "Content-Type: application/json" \
  -d '{"latencyThreshold": 1500}'
```

---

### GET /api/logs-stream

SSE stream of real-time server logs. Connect with an EventSource client.

```javascript
const evtSource = new EventSource("http://127.0.0.1:8550/api/logs-stream");
evtSource.onmessage = (event) => {
  console.log(JSON.parse(event.data));
};
```

---

### GET /status

Returns key states, cooldowns, and server uptime.

```bash
curl http://127.0.0.1:8550/status | jq
```

---

### GET /health

Basic health check returning status, version, and configured auras.

```bash
curl http://127.0.0.1:8550/health
```

---

## Query Parameters — /api/usage

| Parameter | Description |
|-----------|-------------|
| `startDate` | Filter from date (YYYY-MM-DD) |
| `endDate` | Filter to date (YYYY-MM-DD) |
| `aura` | Exact aura name |
| `provider` | Exact provider name |
| `source` | `Testing`, `API`, or hostname |
| `status` | `Success` or `Error` |
| `host` | Client IP or hostname |
| `page` | Page number (default: 1) |
| `limit` | Results per page (default: 50) |

---

## Examples

### Health Check

```bash
curl http://127.0.0.1:8550/health
```

### Status Dashboard

```bash
curl http://127.0.0.1:8550/status | jq
```

### Non-Streaming Completion

```bash
curl http://127.0.0.1:8550/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer aurora-provider-local" \
  -d '{
    "model": "aurora-provider/coder",
    "messages": [{"role": "user", "content": "Write hello world in Python"}],
    "max_tokens": 200
  }'
```

### Streaming Completion

```bash
curl http://127.0.0.1:8550/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer aurora-provider-local" \
  -d '{
    "model": "aurora-provider/build",
    "messages": [{"role": "user", "content": "Explain async/await in JavaScript"}],
    "stream": true,
    "max_tokens": 500
  }'
```

### Using with OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8550/v1",
    api_key="aurora-provider-local"  # any string works
)

response = client.chat.completions.create(
    model="aurora-provider/coder",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)
```

### Running the Server

```bash
# Development (auto-restart on file change)
PORT=8550 bun --watch src/server.js

# Production
PORT=8550 bun src/server.js
```

Dashboard: http://127.0.0.1:8550

---

*Aurora-Provider — Self-hosted multi-provider LLM routing with zero vendor lock-in.*
