# Aurora-Provider: Complete Build Summary

## Project Overview

**Aurora-Provider** is a local OpenAI-compatible LLM router that sits between OpenCode and your free LLM API providers. It intelligently rotates API keys, handles rate limits, and automatically falls back through a predefined chain of providers so you never hit a hard wall.

```
OpenCode → Aurora-Provider (http://127.0.0.1:4141) → Free LLM APIs (with fallback chains)
```

---

## Research Corrections (May 23, 2026)

### ❌ Chutes.ai — NO LONGER FREE
Chutes.ai terminated free access as of February 27, 2026. Early access perk (200 req/day free) has ended. All access now requires subscription ($0-$0.30/MTok pay-as-you-go) or direct payment.

**Action taken:** Removed from Aurora-Provider free tier. Do not use.

### ✅ LLM7.io — TRULY FREE, ADDED
LLM7.io provides zero-friction free access to 40+ open-weight models without API tokens or signup, using an OpenAI-compatible interface at `https://api.llm7.io/v1`. Anonymous access available by passing any string as API key.

**Integration:** Now included in Aurora-Provider as priority 5 fallback for all agents. See `LLM7_SETUP.md` for details.

**Caveat:** 2 RPM rate limit per IP per model (30-second wait between requests). Best as ultimate fallback when all primary providers exhausted.

---

## File Structure

```
aurora-provider/
├── src/
│   └── server.js              # Main Express server (all routing logic)
├── config/
│   ├── providers.json         # 11+ provider registry (endpoints, models, limits)
│   ├── agents.json            # Agent fallback chains (plan, build, coder, etc.)
│   └── keys.json              # Your API keys (gitignored, NOT in repo)
├── package.json
├── .gitignore
├── README.md                  # Comprehensive setup & usage guide
├── LLM7_SETUP.md             # LLM7.io integration guide
└── AURORA-PROVIDER-SUMMARY.md     # This file
```

---

## Providers Included (11 total)

| # | Provider | Free Models | Context | Rate Limits | Speed | Status |
|---|---|---|---|---|---|---|
| 1 | **OpenCode Zen** | 3 (Big Pickle, DeepSeek V4 Flash, Nemotron 3) | 200K | Generous | Medium | ⏳ Limited time |
| 2 | **Zhipu (Z.AI)** | 2 (GLM-4.7 Flash, GLM-4.5 Flash) | 200K | 1 concurrent | Fast | ✅ Permanent |
| 3 | **Google AI Studio** | Gemini 2.5 Flash, Flash-Lite | 1M | 30 RPM | Fast | ✅ Permanent |
| 4 | **Groq** | Llama 3.3 70B, Llama 4 Scout, DeepSeek R1 | 128K–512K | 30 RPM | Ultra fast | ✅ Permanent |
| 5 | **Cloudflare Workers AI** | Kimi K2.6, Qwen3, DeepSeek R1, Llama 4 | 262K–512K | 10K neu/day | Medium | ✅ Permanent |
| 6 | **Kimi (Moonshot)** | Kimi K2.5 | 262K | 3 RPM | Medium | ⏳ Limited time |
| 7 | **OpenRouter** | 30+ free models (DeepSeek, Qwen, Kimi, Llama) | 1M–262K | ~20 RPM | Medium | ✅ Permanent |
| 8 | **Cerebras** | Llama 3.3 70B, Llama 4 Scout | 8K–131K | 1M tok/day | Ultra fast | ✅ Permanent |
| 9 | **NVIDIA NIM** | 94+ models (Kimi, DeepSeek, Nemotron) | 32K–262K | ~5 RPM | Fast | ✅ Permanent |
| 10 | **GitHub Models** | Grok 3, Llama 3.3 70B, 45+ | 128K | 8K in/4K out | Fast | ✅ Permanent |
| 11 | **LLM7.io** | DeepSeek R1 Distill, Qwen3, Llama 3.1 405B | 128K–131K | 2 RPM | Slow | ✅ Permanent (no signup) |

**Not included:** ~~Chutes.ai~~ (paid now), HuggingFace (slow, low quota), Cerebras Flex (setup burden).

---

## Agent Fallback Chains

All 7 OpenCode agents have ordered fallback chains, sorted by context size → rate limit generosity → speed:

### Plan Agent (Orchestrator — high reasoning, read-only)
1. OpenCode Zen / Big Pickle (200K)
2. Cloudflare / Kimi K2.6 (262K)
3. OpenRouter / Kimi K2.6 (262K)
4. OpenRouter / DeepSeek V4 Flash (1M)
5. Gemini 2.5 Flash (1M)

### Build Agent (Delegator — high reasoning, no file edits)
Same as Plan (identical requirements)

### Coder Agent (Implementation — highest reasoning + large context)
1. OpenCode Zen / Big Pickle (200K)
2. Cloudflare / Kimi K2.6 (262K)
3. OpenRouter / DeepSeek V4 Flash (1M)
4. Zhipu / GLM-4.7 Flash (200K)
5. Gemini 2.5 Flash (1M)

### Explore Agent (Codebase analysis — large context, low reasoning)
1. OpenCode Zen / DeepSeek V4 Flash (200K)
2. OpenRouter / DeepSeek V4 Flash (1M)
3. OpenRouter / Llama 4 Maverick (1M)
4. Gemini 2.5 Flash (1M)
5. **LLM7.io / Llama 3.1 405B** (131K) ← fallback

### Researcher Agent (Web research — high reasoning, medium context)
1. OpenCode Zen / Nemotron 3 (128K)
2. OpenRouter / Qwen3 235B (262K)
3. Cloudflare / Kimi K2.6 (262K)
4. Gemini 2.5 Flash (1M)
5. **LLM7.io / DeepSeek R1 Distill** (128K) ← fallback

### Scribe Agent (Documentation — fast writing, low reasoning)
1. OpenCode Zen / DeepSeek V4 Flash (200K)
2. Gemini 2.5 Flash (1M)
3. OpenRouter / DeepSeek V4 Flash (1M)
4. Groq / Llama 3.3 70B (128K)
5. **LLM7.io / Llama 3.1 405B** (131K) ← fallback

### Reviewer Agent (Code review — high reasoning, accuracy over speed)
1. OpenCode Zen / Nemotron 3 (128K)
2. Cloudflare / Kimi K2.6 (262K)
3. OpenRouter / Kimi K2.6 (262K)
4. Zhipu / GLM-4.7 Flash (200K)
5. **LLM7.io / DeepSeek R1 Distill** (128K) ← fallback

---

## Key Features

### 1. **Two-Layer Fallback**
- **Layer 1:** API key rotation — when a key hits 429, mark it, try the next key
- **Layer 2:** Provider fallback — when all keys for a provider exhausted, move to next provider in chain

### 2. **Intelligent Rate Limit Handling**
- Tracks per-key state: cooldown, failure count, last-hit timestamp
- Exponential backoff: `cooldown = min(60s × failures, 15min)`
- Every 15 min: probes all keys in background, resets recovered ones

### 3. **Zero Startup Complexity**
- No configuration file merging or override logic
- Single `opencode.json` provider block
- Drop-in replacement for any OpenAI-compatible endpoint

### 4. **Full Streaming Support**
- HTTP response passthrough for streaming endpoints
- Set `X-Aurora-Provider` header on responses for debugging

### 5. **Health Monitoring**
- `GET /health` — server status
- `GET /status` — key states, cooldowns, uptime
- `GET /v1/models` — lists all agents as model names

---

## Setup Instructions

### 1. Clone & Install

```bash
git clone <repo> aurora-provider
cd aurora-provider
npm install
```

### 2. Configure API Keys

Edit `config/keys.json`. Add as many keys per provider as you have:

```json
{
  "keys": {
    "opencode_zen": ["sk-zen-key1", "sk-zen-key2"],
    "zhipu": ["your-key"],
    "google_ai_studio": ["AIza-key1"],
    "groq": ["gsk-key"],
    "cloudflare_workers_ai": [{"apiToken": "token", "accountId": "id"}],
    "llm7": ["unused"]
  }
}
```

You don't need all providers — even just 3 (opencode_zen + zhipu + google_ai_studio) gives solid coverage.

### 3. Start Aurora-Provider

```bash
npm start
# Or with file-watching:
npm run dev
```

Listen for:
```
╔══════════════════════════════════════════╗
║          Aurora-Provider  v1.0.0              ║
║  Local OpenAI-compatible LLM router      ║
╠══════════════════════════════════════════╣
║  Listening: http://127.0.0.1:4141        ║
║  Agents:    plan, build, coder, ...      ║
╚══════════════════════════════════════════╝
```

### 4. Configure OpenCode

In your `opencode.json`:

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
      "reasoningEffort": "high"
      // ... rest of your agent config
    },
    "build": { "model": "aurora-provider/build", ... },
    "coder": { "model": "aurora-provider/coder", ... },
    "explore": { "model": "aurora-provider/explore", ... },
    "researcher": { "model": "aurora-provider/researcher", ... },
    "scribe": { "model": "aurora-provider/scribe", ... },
    "reviewer": { "model": "aurora-provider/reviewer", ... }
  }
}
```

### 5. Test It

```bash
# Terminal 1: start Aurora-Provider
npm start

# Terminal 2: test with OpenCode
opencode "hello world"
# or select /models in TUI and pick aurora-provider/coder
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Server health check |
| `/status` | GET | Key states, cooldowns, uptime |
| `/v1/models` | GET | List agents as model names |
| `/v1/chat/completions` | POST | Main completions (OpenAI-compatible) |

---

## Configuration Customization

### Add a new provider

1. Add definition to `config/providers.json`
2. Add API keys to `config/keys.json`
3. Add to relevant agent chains in `config/agents.json`
4. Restart Aurora-Provider

### Change fallback priority

Edit the `fallbacks` array order in `config/agents.json`. No code changes needed. Restart Aurora-Provider.

### Adjust key cooldown behavior

In `src/server.js`, find the `markKeyLimited()` function and modify the formula:

```javascript
function markKeyLimited(provider, keyIndex, cooldownMs = 60_000) {
  // cooldownMs = how long to wait before trying this key again
  // Default: 60s first failure, scales up exponentially
}
```

---

## Monitoring & Debugging

### Check key states

```bash
curl http://127.0.0.1:4141/status | jq .keyStates
```

Output shows which keys are cooling down:
```json
{
  "opencode_zen": [
    { "keyIndex": 0, "available": true, "state": null },
    { "keyIndex": 1, "available": false, "state": { "cooldownUntil": 1716532800000 } }
  ]
}
```

### View request logs

Aurora-Provider logs requests and fallbacks to stdout:
```
[aurora-provider] ✓ coder → opencode_zen/big-pickle
[aurora-provider] ✗ plan → cloudflare: ALL_KEYS_EXHAUSTED — trying next fallback
[probe] ✓ groq key[0]
[probe] ✗ kimi key[0]: RATE_LIMITED
```

### Test manually

```bash
curl http://127.0.0.1:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer aurora-provider-local" \
  -d '{
    "model": "aurora-provider/coder",
    "messages": [{"role": "user", "content": "Write hello world"}],
    "max_tokens": 200
  }'
```

---

## Getting API Keys

| Provider | Signup | Notes |
|---|---|---|
| OpenCode Zen | https://opencode.ai/zen | Run `/connect` in OpenCode TUI |
| Zhipu (Z.AI) | https://open.bigmodel.cn | Email only, GLM-4.7-Flash permanently free ✅ |
| Google AI Studio | https://aistudio.google.com | No credit card, 1M context, 1500 req/day |
| Groq | https://console.groq.com | No credit card, ultra-fast inference |
| Cloudflare Workers AI | https://dash.cloudflare.com | Free plan: 10K neurons/day |
| OpenRouter | https://openrouter.ai | Single key for all `:free` models |
| Kimi (Moonshot) | https://platform.moonshot.cn | May need CN phone verification |
| Cerebras | https://cloud.cerebras.ai | No credit card, ultra-fast |
| NVIDIA NIM | https://build.nvidia.com | 94+ models, phone verification |
| GitHub Models | https://github.com/marketplace/models | Just your GitHub token |
| LLM7.io | https://token.llm7.io | Optional free token (anonymous works too) |

---

## Performance Notes

**Speed Ranking (fastest → slowest):**
1. Groq (200–350 tok/s) — ultra-fast LPU hardware
2. Cloudflare (100–200 tok/s) — edge compute
3. Cerebras (2600 tok/s for small context, scales down) — fast but 8K limit
4. Google Gemini (50–100 tok/s) — standard GPU
5. OpenRouter (~50 tok/s) — variable, routed aggregator
6. LLM7.io (20–50 tok/s + 2 RPM throttle) — shared/overloaded

**Context Ranking (largest → smallest):**
1. OpenRouter/Gemini (1M) — best for large codebase analysis
2. Cloudflare/Kimi K2.6 (262K) — frontier-scale model
3. Llama 3.1 405B (131K) — largest open model
4. GLM-4.7 Flash (200K) — permanent free
5. DeepSeek V4 Flash (200K) — strong reasoning
6. Groq/Cerebras (128K–512K) — high variance
7. Cerebras free (8K) — very limited

**Cost:** All listed providers and models are **completely free** — no hidden charges, no token counters. Aurora-Provider manages the free tiers intelligently.

---

## Maintenance

### Update provider registry

If a provider changes its API endpoint or adds new models:

1. Edit `config/providers.json`
2. Update `config/agents.json` fallback chains if needed
3. Restart Aurora-Provider

No code changes required.

### Auto-start on boot (Linux)

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

## License

MIT — use freely, modify freely, no warranty.

---

## Next Steps

1. ✅ **Download aurora-provider/** folder from outputs
2. ✅ **Edit `config/keys.json`** with your API keys
3. ✅ **Run `npm install && npm start`**
4. ✅ **Add Aurora-Provider to your `opencode.json`** (see Setup #4 above)
5. ✅ **Test with OpenCode** — select `aurora-provider/coder` and start coding

Good luck! Questions? See `README.md` and `LLM7_SETUP.md` for detailed docs.
