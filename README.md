# Aurora-Provider

> **Local OpenAI-compatible LLM router** — one endpoint, unlimited free fallback chains, zero vendor lock-in.

Aurora-Provider runs as a tiny local server (`http://127.0.0.1:4141`) and exposes an OpenAI-compatible API. When OpenCode (or any agent) sends a request to model `aurora-provider/build`, Aurora-Provider:

1. Looks up the **agent** (`build`) and its ordered **fallback chain**
2. Picks the **first available provider** in that chain
3. Rotates through **all API keys** for that provider on rate-limit (429)
4. Falls back to the **next provider** when all keys are exhausted
5. Every 15 minutes, **probes all keys** and resets cooled-down ones

---

## Architecture

```
OpenCode
  │
  │  POST /v1/chat/completions
  │  model: "aurora-provider/build"
  ▼
┌─────────────────────────────────────────────────────┐
│                    Aurora-Provider                        │
│                                                      │
│  1. Resolve model name → agent name ("build")        │
│  2. Load agent fallback chain from agents.json       │
│  3. For each (provider, model) in chain:             │
│     a. Get next available key for provider           │
│     b. Forward request to provider API               │
│     c. On 429 → mark key, try next key               │
│     d. All keys exhausted → next provider in chain   │
│  4. Return upstream response (streaming supported)   │
│                                                      │
│  Background: every 15 min probe all keys, reset OK  │
└─────────────────────────────────────────────────────┘
  │
  ├── opencode_zen     → https://opencode.ai/zen/v1
  ├── zhipu            → https://open.bigmodel.cn/api/paas/v4
  ├── google_ai_studio → https://generativelanguage.googleapis.com/v1beta/openai
  ├── cloudflare       → https://api.cloudflare.com/.../ai/v1
  ├── openrouter       → https://openrouter.ai/api/v1
  ├── groq             → https://api.groq.com/openai/v1
  └── ... more
```

### Two-Layer Fallback

```
Request for agent "coder"
  │
  Layer 1: Provider + Key Rotation
  ├── opencode_zen / big-pickle
  │   ├── key[0] → 429 → mark, try key[1]
  │   ├── key[1] → 429 → all exhausted → next provider
  │
  Layer 2: Provider Fallback Chain
  ├── cloudflare / kimi-k2.6 → success ✓
  │
  Done.
```

---

## Fallback Chain Design

Each agent's fallback chain is sorted by:

1. **Context size** (largest first) — all OpenCode agents need large context
2. **Rate limit generosity** (unlimited/daily > RPM-limited)
3. **Speed** (fastest inference last resort, since speed < capability for coding)

| Agent | Priority 1 | Priority 2 | Priority 3 | Priority 4 | Priority 5 |
|---|---|---|---|---|---|
| **plan** | OpenCode Zen / Big Pickle | Cloudflare / Kimi K2.6 | OpenRouter / Kimi K2.6 | OpenRouter / DeepSeek V4 Flash | Gemini 2.5 Flash |
| **build** | OpenCode Zen / Big Pickle | Cloudflare / Kimi K2.6 | OpenRouter / Kimi K2.6 | OpenRouter / DeepSeek V4 Flash | Gemini 2.5 Flash |
| **coder** | OpenCode Zen / Big Pickle | Cloudflare / Kimi K2.6 | OpenRouter / DeepSeek V4 Flash | Zhipu / GLM-4.7 Flash | Gemini 2.5 Flash |
| **explore** | OpenCode Zen / DeepSeek V4 Flash | OpenRouter / DeepSeek V4 Flash | OpenRouter / Llama 4 Maverick | Gemini 2.5 Flash | Groq / Llama 4 Scout |
| **researcher** | OpenCode Zen / Nemotron 3 Super | OpenRouter / Qwen3 235B | Cloudflare / Kimi K2.6 | Gemini 2.5 Flash | NVIDIA NIM / Nemotron |
| **scribe** | OpenCode Zen / DeepSeek V4 Flash | Gemini 2.5 Flash | OpenRouter / DeepSeek V4 Flash | Groq / Llama 3.3 70B | Zhipu / GLM-4.7 Flash |
| **reviewer** | OpenCode Zen / Nemotron 3 Super | Cloudflare / Kimi K2.6 | OpenRouter / Kimi K2.6 | Zhipu / GLM-4.7 Flash | Gemini 2.5 Flash |

---

## Provider Registry

All providers in `config/providers.json`. Summary:

| Provider | Free Models | Context | Rate Limits | Speed | Permanent |
|---|---|---|---|---|---|
| **OpenCode Zen** | Big Pickle, DeepSeek V4 Flash, Nemotron 3 | 200K | Generous (undocumented) | Medium | No (limited time) |
| **Cloudflare Workers AI** | Kimi K2.6, Qwen3, DeepSeek R1, Llama 4 | 262K / 512K | 10K neurons/day | Medium | Yes |
| **Google AI Studio** | Gemini 2.5 Flash, Flash-Lite | 1M | 30 RPM / 1500 RPD | Fast | Yes |
| **OpenRouter (free)** | DeepSeek V4 Flash, Qwen3 235B, Kimi K2.6, Llama 4 Maverick | 1M / 262K | ~20 RPM | Medium | No |
| **Zhipu (Z.AI)** | GLM-4.7 Flash, GLM-4.5 Flash | 200K | 1 concurrent req | Fast | Yes ✓ |
| **Groq** | Llama 3.3 70B, Llama 4 Scout, DeepSeek R1 | 128K–512K | 30 RPM / 1K RPD | Ultra fast | Yes |
| **Kimi (Moonshot)** | Kimi K2.5 | 262K | 3 RPM / 1.5M TPD | Medium | No |
| **Cerebras** | Llama 3.3 70B, Llama 4 Scout | 8K–131K | 1M tok/day | Ultra fast | Yes |
| **NVIDIA NIM** | Kimi K2, DeepSeek V3.2, Nemotron 3 | 32K–262K | ~5 RPM | Fast | No |
| **GitHub Models** | Grok 3, Llama 3.3 70B, 45+ | 128K | 8K in / 4K out | Fast | Yes |
| **LLM7.io** | DeepSeek R1 Distill, Qwen3, Llama 3.1 405B | 128K–131K | 2 RPM per IP | Slow–Medium | Yes (no signup) |
| ~~**Chutes AI**~~ | ~~All~~ | — | **PAID NOW** (ended Feb 2026) | — | **❌ No longer free** |

---

## Setup

### 1. Install

```bash
git clone <this-repo> aurora-provider
cd aurora-provider
npm install
```

### 2. Add API Keys

Edit `config/keys.json`. Add as many keys per provider as you have:

```json
{
  "keys": {
    "opencode_zen": [
      "sk-zen-key1",
      "sk-zen-key2"
    ],
    "zhipu": [
      "your-zhipu-key"
    ],
    "google_ai_studio": [
      "AIza-key1",
      "AIza-key2",
      "AIza-key3"
    ],
    "groq": [
      "gsk_key1",
      "gsk_key2"
    ],
    "cloudflare_workers_ai": [
      {
        "apiToken": "your-cf-token",
        "accountId": "your-account-id"
      }
    ],
    "openrouter": [
      "sk-or-key1"
    ],
    "llm7": [
      "YOUR_LLM7_TOKEN_1"
    ]
  }
}
```

**Providers with no keys configured are automatically skipped in the fallback chain.**

You don't need all providers — even just `opencode_zen` + `zhipu` + `google_ai_studio` gives solid coverage.

### 3. Start Aurora-Provider

```bash
npm start
```

Or with file-watching for development:
```bash
npm run dev
```

You should see:
```
╔══════════════════════════════════════════╗
║          Aurora-Provider  v1.0.0              ║
║  Local OpenAI-compatible LLM router      ║
╠══════════════════════════════════════════╣
║  Listening: http://127.0.0.1:4141        ║
║  Agents:    plan, build, coder, ...      ║
╚══════════════════════════════════════════╝
```

### 4. Auto-start on Boot (Linux systemd)

Create `/etc/systemd/system/aurora-provider.service`:

```ini
[Unit]
Description=Aurora-Provider LLM Router
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/aurora-provider
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable aurora-provider
sudo systemctl start aurora-provider
```

---

## OpenCode Configuration

Add Aurora-Provider as a custom provider in your `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "aurora-provider": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Aurora-Provider",
      "options": {
        "baseURL": "http://127.0.0.1:4141/v1",
        "apiKey": "aurora-provider-local"
      },
      "models": {
        "aurora-provider/plan": {
          "name": "Plan Agent",
          "limit": { "context": 200000, "output": 65536 }
        },
        "aurora-provider/build": {
          "name": "Build Agent",
          "limit": { "context": 200000, "output": 65536 }
        },
        "aurora-provider/coder": {
          "name": "Coder Agent",
          "limit": { "context": 200000, "output": 65536 }
        },
        "aurora-provider/explore": {
          "name": "Explore Agent",
          "limit": { "context": 200000, "output": 65536 }
        },
        "aurora-provider/researcher": {
          "name": "Researcher Agent",
          "limit": { "context": 128000, "output": 32768 }
        },
        "aurora-provider/scribe": {
          "name": "Scribe Agent",
          "limit": { "context": 200000, "output": 65536 }
        },
        "aurora-provider/reviewer": {
          "name": "Reviewer Agent",
          "limit": { "context": 128000, "output": 32768 }
        }
      }
    }
  },
  "agent": {
    "plan": {
      "model": "aurora-provider/plan",
      "temperature": 0.3,
      "reasoningEffort": "high",
      "textVerbosity": "low",
      "permission": {
        "edit": "deny",
        "write": "deny",
        "bash": { "*": "deny" },
        "task": "allow",
        "worktree_*": "allow"
      }
    },
    "build": {
      "model": "aurora-provider/build",
      "temperature": 0.3,
      "reasoningEffort": "medium",
      "textVerbosity": "low",
      "permission": {
        "edit": "deny",
        "write": "deny",
        "bash": { "*": "deny" },
        "task": "allow",
        "worktree_*": "allow"
      }
    },
    "coder": {
      "model": "aurora-provider/coder",
      "temperature": 0.2,
      "reasoningEffort": "high",
      "textVerbosity": "low",
      "permission": {
        "read": "allow",
        "write": "allow",
        "edit": "allow",
        "glob": "allow",
        "grep": "allow",
        "bash": "allow"
      }
    },
    "explore": {
      "model": "aurora-provider/explore",
      "temperature": 0.2,
      "reasoningEffort": "low",
      "textVerbosity": "low",
      "permission": {
        "edit": "deny",
        "write": "deny",
        "bash": {
          "*": "deny",
          "ls *": "allow",
          "cat *": "allow",
          "git *": "allow",
          "grep *": "allow",
          "find *": "allow"
        }
      }
    },
    "researcher": {
      "model": "aurora-provider/researcher",
      "temperature": 0.4,
      "reasoningEffort": "high",
      "textVerbosity": "medium",
      "permission": {
        "context7_*": "allow",
        "exa_*": "allow",
        "webfetch": "allow",
        "write": "deny",
        "edit": "deny"
      }
    },
    "scribe": {
      "model": "aurora-provider/scribe",
      "temperature": 1,
      "reasoningEffort": "low",
      "textVerbosity": "high",
      "permission": {
        "bash": { "*": "deny" },
        "edit": "allow",
        "read": "allow",
        "write": "allow"
      }
    },
    "reviewer": {
      "model": "aurora-provider/reviewer",
      "temperature": 0.1,
      "reasoningEffort": "high",
      "textVerbosity": "medium",
      "permission": {
        "edit": "deny",
        "write": "deny",
        "bash": {
          "*": "deny",
          "git diff*": "allow",
          "git log*": "allow"
        }
      }
    }
  }
}
```

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Server health check |
| `GET /status` | Key states, cooldowns, uptime |
| `GET /v1/models` | List all agents as model IDs |
| `POST /v1/chat/completions` | Main completions — OpenAI compatible |

### Test it manually

```bash
# Health
curl http://127.0.0.1:4141/health

# Status dashboard
curl http://127.0.0.1:4141/status | jq

# Test a completion
curl http://127.0.0.1:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer aurora-provider-local" \
  -d '{
    "model": "aurora-provider/coder",
    "messages": [{"role": "user", "content": "Write hello world in Python"}],
    "max_tokens": 200
  }'
```

---

## Customization

### Add a new provider

1. Add provider definition to `config/providers.json`
2. Add API keys to `config/keys.json`
3. Add it to relevant agent fallback chains in `config/agents.json`
4. Restart Aurora-Provider

### Add a new agent

1. Add agent entry to `config/agents.json` with fallback chain
2. Add corresponding model to `opencode.json` provider block
3. Add agent config to `opencode.json` agent block
4. Restart Aurora-Provider

### Change fallback priority

Edit the `fallbacks` array order in `config/agents.json`. No code changes needed. Restart Aurora-Provider.

### Change key cooldown behavior

In `src/server.js`, find `markKeyLimited` and adjust the `cooldownMs` formula.

---

## How Key Rotation Works

```
Provider "groq" has keys: [key0, key1, key2]

Request comes in:
  → try key0 → 429 → mark key0 (60s cooldown)
  → try key1 → 429 → mark key1 (60s cooldown)
  → try key2 → success ✓

Later request (same minute):
  → key0 still cooling → skip
  → key1 still cooling → skip
  → try key2 → success ✓

After 60s:
  → key0 available again (probe confirmed OK)
  → key1 available again
```

Cooldown scales with failures: `min(60s × failures, 15min)`. A key that fails repeatedly stays blocked longer.

---

## File Structure

```
aurora-provider/
├── src/
│   └── server.js          # Main server — all routing logic
├── config/
│   ├── providers.json     # Provider registry (API URLs, models, limits)
│   ├── agents.json        # Agent fallback chains
│   └── keys.json          # Your API keys (gitignored)
├── package.json
├── .gitignore
└── README.md
```

---

## Getting API Keys

| Provider | Signup | Notes |
|---|---|---|
| OpenCode Zen | https://opencode.ai/zen | Run `/connect` in OpenCode TUI |
| Zhipu (Z.AI) | https://open.bigmodel.cn | Email only, GLM-4.7-Flash permanently free |
| Google AI Studio | https://aistudio.google.com | Best free tier, 1M context, 1500 req/day |
| Groq | https://console.groq.com | No credit card, ultra fast |
| Cloudflare Workers AI | https://dash.cloudflare.com | Free plan: 10K neurons/day |
| OpenRouter | https://openrouter.ai | Single key for all `:free` models |
| Kimi (Moonshot) | https://platform.moonshot.cn | May need CN phone number |
| Cerebras | https://cloud.cerebras.ai | Ultra fast but 8K context on free |
| NVIDIA NIM | https://build.nvidia.com | 94+ models, phone verification needed |
| GitHub Models | https://github.com/marketplace/models | Just your GitHub token |
| LLM7.io | https://token.llm7.io | Free token, no signup for anonymous access |
| **Chutes.ai** | **https://chutes.ai** | **PAID NOW — not free anymore as of Feb 2026** |

---

## License

MIT — use freely, modify freely, no warranty.
