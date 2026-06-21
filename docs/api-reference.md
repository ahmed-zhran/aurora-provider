# API Reference

> Complete API endpoint reference for Aurora-Provider v2.

---

## OpenAI-Compatible Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | Main inference endpoint (streaming supported) |
| `GET`  | `/v1/models` | List all auras as OpenAI model objects |

**Model naming:** Use `aurora-provider/<aura-name>` as the model ID.

Examples: `aurora-provider/seolla-nyx-aura`, `aurora-provider/lyra-nyx-aura`

---

### POST /v1/chat/completions

The main inference endpoint. Fully compatible with the OpenAI Chat Completions API. Models are resolved to aura names, which trigger fallback chain dispatch through Bifrost.

**Request:**

```bash
curl http://127.0.0.1:8550/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer any-string-works" \
  -d '{
    "model": "aurora-provider/seolla-nyx-aura",
    "messages": [{"role": "user", "content": "Write hello world in Python"}],
    "max_tokens": 200
  }'
```

**Request Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Aura model ID (e.g. `aurora-provider/seolla-nyx-aura`) |
| `messages` | array | Yes | Array of message objects with `role` and `content` |
| `stream` | boolean | No | Enable SSE streaming (default: `false`) |
| `max_tokens` | integer | No | Maximum tokens in the response |
| `temperature` | number | No | Sampling temperature (0-2) |

**Headers:**

| Header | Description |
|--------|-------------|
| `Authorization` | `Bearer <any-string>` (required by OpenAI SDK, value is ignored by aurora-provider, but Bifrost may validate it) |
| `Content-Type` | `application/json` |

**Response (non-streaming):**

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1716000000,
  "model": "aurora-provider/seolla-nyx-aura",
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

When `stream: true`, the response is delivered as Server-Sent Events (SSE) chunks. Aurora-Provider re-streams Bifrost's SSE output directly without buffering.

```
data: {"choices":[{"delta":{"role":"assistant"},"index":0}]}

data: {"choices":[{"delta":{"content":"print"},"index":0}]}

data: {"choices":[{"delta":{"content":"('Hello"},"index":0}]}

data: [DONE]
```

**Error Responses:**

| Status | Condition | Body |
|--------|-----------|------|
| 400 | Unknown aura/model | `{ "error": { "message": "Unknown model/aura: ...", "type": "invalid_request_error" } }` |
| 400 | Invalid JSON body | `{ "error": { "message": "Invalid JSON body", "type": "invalid_request_error" } }` |
| 400 | Missing model field | `{ "error": { "message": "model is required", "type": "invalid_request_error" } }` |
| 503 | All fallbacks exhausted | `{ "error": { "message": "Aurora-Provider: ...", "type": "service_unavailable" } }` |

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
    {
      "id": "aurora-provider/seolla-nyx-aura",
      "object": "model",
      "created": 1716000000,
      "owned_by": "aurora-provider"
    }
  ]
}
```

---

## Management API

### GET /api/health

Health check returning server status, version, configured auras, and Bifrost connectivity.

**Request:**

```bash
curl http://127.0.0.1:8550/api/health
```

**Response:**

```json
{
  "status": "ok",
  "version": "2.0.0",
  "auras": ["seolla-nyx-aura"],
  "bifrost": "connected",
  "bifrostEndpoint": "http://localhost:10550"
}
```

---

### Aura Management

#### GET /api/auras

Returns all aura definitions.

```bash
curl http://127.0.0.1:8550/api/auras
```

**Response:**

```json
{
  "auras": {
    "seolla-nyx-aura": {
      "fallbacks": [
        { "provider": "bifrost", "model": "opencode-zen/big-pickle", "contextWindow": 200000, "reasoning": true },
        { "provider": "bifrost", "model": "mistral/mistral-medium-3-5", "contextWindow": 262144 }
      ]
    }
  }
}
```

#### POST /api/auras

Create or update an aura definition. Replaces the entire auras configuration with the provided data.

**Request:**

```bash
curl -X POST http://127.0.0.1:8550/api/auras \
  -H "Content-Type: application/json" \
  -d '{
    "auras": {
      "my-aura": {
        "fallbacks": [
          { "provider": "bifrost", "model": "opencode-zen/big-pickle" }
        ]
      }
    }
  }'
```

**Response:**

```json
{
  "success": true
}
```

#### DELETE /api/auras/:name

Delete a single aura by name.

```bash
curl -X DELETE http://127.0.0.1:8550/api/auras/seolla-nyx-aura
```

**Response (success):**

```json
{ "success": true }
```

**Response (not found):**

```json
{ "error": "Aura \"seolla-nyx-aura\" not found" }
```

---

### Usage Logs

#### GET /api/logs

Query usage logs with filtering, pagination, and statistics.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `startDate` | string (YYYY-MM-DD) | Filter logs from this date |
| `endDate` | string (YYYY-MM-DD) | Filter logs to this date |
| `aura` | string | Filter by aura name |
| `status` | string | Filter by status (`Success` or `Error`) |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 50) |

**Request:**

```bash
curl "http://127.0.0.1:8550/api/logs?status=Success&page=1&limit=10"
```

**Response:**

```json
{
  "success": true,
  "logs": [
    {
      "id": 1,
      "timestamp": "2026-06-21 12:00:00",
      "aura": "seolla-nyx-aura",
      "model": "opencode-zen/big-pickle",
      "status": "Success",
      "latency_ms": 1234,
      "error": null
    }
  ],
  "totalCount": 100,
  "successCount": 95,
  "avgLatency": 1200,
  "stats": {
    "auras": [{ "aura": "seolla-nyx-aura", "count": 100 }],
    "models": [{ "model": "opencode-zen/big-pickle", "count": 60 }],
    "timeSeries": [{ "date": "2026-06-21", "count": 100 }]
  }
}
```

#### POST /api/logs/clear

Delete all usage log entries.

```bash
curl -X POST http://127.0.0.1:8550/api/logs/clear
```

**Response:**

```json
{ "success": true, "message": "Usage logs cleared." }
```

---

### Settings

#### GET /api/settings

Returns current server settings.

```bash
curl http://127.0.0.1:8550/api/settings
```

**Response:**

```json
{
  "latencyThreshold": 100,
  "enableProxy": false
}
```

#### PUT /api/settings

Updates server settings. Only accepted keys are applied.

**Request:**

```bash
curl -X PUT http://127.0.0.1:8550/api/settings \
  -H "Content-Type: application/json" \
  -d '{"latencyThreshold": 500}'
```

**Response:**

```json
{
  "latencyThreshold": 500,
  "enableProxy": false
}
```

---

## Dashboard UI

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Single-page dashboard HTML |
| `GET` | `/index.js` | Dashboard JavaScript bundle |
| `GET` | `/index.css` | Dashboard stylesheet |

The dashboard provides three tabs: Dashboard (usage analytics), Auras (configuration), and API Tester (test endpoint).

---

## Database Schema

Usage logs are stored in `vault/vault.db` (SQLite, WAL mode):

```sql
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT (datetime('now')),
  aura TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'Success',
  latency_ms INTEGER,
  error TEXT
);

CREATE INDEX idx_usage_timestamp ON usage_logs(timestamp);
CREATE INDEX idx_usage_aura ON usage_logs(aura);
CREATE INDEX idx_usage_status ON usage_logs(status);
```

---

*Last updated: 2026-06-21*
