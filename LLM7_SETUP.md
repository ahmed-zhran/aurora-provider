# LLM7.io Setup Guide

## What is LLM7.io?

LLM7.io is a zero-friction API gateway providing free, anonymous access to 40+ state-of-the-art open models without registration, payment, or API tokens. The service is available at `https://api.llm7.io/v1` and uses an OpenAI-compatible interface.

**Key traits:**
- No API key needed — anonymous access works. You can pass `api_key="unused"` or any string.
- Optional free token for higher limits: get one at `https://token.llm7.io`
- **Rate limit:** 2 requests per minute per IP per model (very slow, best as fallback)
- **Permanent:** Yes, free tier is ongoing
- **Models:** DeepSeek R1 Distill, Qwen3 32B, Llama 3.1 405B, and 40+ others

---

## Method 1: Use Aurora-Provider (Easiest)

Aurora-Provider already includes LLM7.io as a fallback for all agents. Just:

1. **Configure Aurora-Provider** (see main README)
2. **Add LLM7 to `config/keys.json`:**

```json
{
  "keys": {
    "llm7": [
      "YOUR_LLM7_TOKEN_1"
    ]
  }
}
```

Get a free token here: https://token.llm7.io (or use dummy string `"unused"` for anonymous access)

3. **Restart Aurora-Provider** — LLM7.io is already in agent fallback chains as a last-resort option

Done. When all other providers are exhausted, requests fall back to LLM7.io automatically.

---

## Method 2: Direct OpenCode Configuration (No Aurora-Provider)

Add LLM7.io directly to your `opencode.json` as a custom provider:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "llm7": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LLM7.io",
      "options": {
        "baseURL": "https://api.llm7.io/v1",
        "apiKey": "YOUR_LLM7_TOKEN_OR_UNUSED"
      },
      "models": {
        "deepseek-r1-distill-llama-70b": {
          "name": "DeepSeek R1 Distill Llama 70B",
          "limit": { "context": 128000, "output": 32768 }
        },
        "qwen3-32b": {
          "name": "Qwen3 32B",
          "limit": { "context": 128000, "output": 32768 }
        },
        "llama-3.1-405b": {
          "name": "Llama 3.1 405B",
          "limit": { "context": 131072, "output": 16384 }
        }
      }
    }
  },
  "agent": {
    "explore": {
      "model": "deepseek-r1-distill-llama-70b",
      "temperature": 0.2,
      "reasoningEffort": "low"
      // ... rest of config
    }
  }
}
```

Then in OpenCode:
1. `/connect`
2. Select "Other"
3. Enter provider ID: `llm7`
4. Paste your token (or just type `unused`)

---

## Full OpenCode Integration (All Agents)

If you want LLM7.io as your primary provider (⚠️ **very slow** due to 2 RPM limit):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "llm7": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LLM7.io",
      "options": {
        "baseURL": "https://api.llm7.io/v1",
        "apiKey": "unused"  // No token needed for anonymous access
      },
      "models": {
        "deepseek-r1-distill-llama-70b": {
          "name": "DeepSeek R1 (LLM7)",
          "limit": { "context": 128000, "output": 32768 }
        },
        "qwen3-32b": {
          "name": "Qwen3 32B (LLM7)",
          "limit": { "context": 128000, "output": 32768 }
        }
      }
    }
  },
  "agent": {
    "plan": {
      "model": "deepseek-r1-distill-llama-70b",
      "temperature": 0.3,
      "reasoningEffort": "high"
    },
    "build": {
      "model": "deepseek-r1-distill-llama-70b",
      "temperature": 0.3,
      "reasoningEffort": "medium"
    },
    "coder": {
      "model": "qwen3-32b",
      "temperature": 0.2,
      "reasoningEffort": "high"
    },
    "explore": {
      "model": "deepseek-r1-distill-llama-70b",
      "temperature": 0.2,
      "reasoningEffort": "low"
    },
    "researcher": {
      "model": "deepseek-r1-distill-llama-70b",
      "temperature": 0.4,
      "reasoningEffort": "high"
    },
    "scribe": {
      "model": "qwen3-32b",
      "temperature": 1,
      "reasoningEffort": "low"
    },
    "reviewer": {
      "model": "deepseek-r1-distill-llama-70b",
      "temperature": 0.1,
      "reasoningEffort": "high"
    }
  }
}
```

---

## Pros & Cons

### ✅ Pros
- Completely free (no credit card, no signup required)
- 40+ open models available
- GDPR-compliant (EU servers)
- OpenAI-compatible
- Perfect as ultimate fallback

### ❌ Cons
- **Very slow:** 2 RPM = 30-second wait between requests
- High latency on inference (models are shared/overloaded)
- No guarantees on availability (best-effort, not SLA)
- Not suitable for primary/active development
- Context limited: max 131K (smaller than Gemini/OpenRouter)

---

## When to Use LLM7.io

| Scenario | Recommended |
|----------|---|
| Primary coding agent | ❌ Too slow |
| Secondary fallback | ✅ Yes (backup) |
| Night-time batch jobs | ✅ Perfect (async, no hurry) |
| Research/exploration | ⚠️ Acceptable (if patient) |
| Rate-limit exceeded | ✅ Yes (guaranteed free access) |

---

## Available Models

```bash
# Test anonymously
curl https://api.llm7.io/v1/chat/completions \
  -H "Authorization: Bearer unused" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-r1-distill-llama-70b",
    "messages": [{"role": "user", "content": "Say OK"}],
    "max_tokens": 5
  }'
```

Full model list at: https://api.llm7.io/v1/models (or check the LLM7 dashboard)

Key models for coding:
- `deepseek-r1-distill-llama-70b` — reasoning distill (best for complex logic)
- `qwen3-32b` — MoE model (fastest of the bunch)
- `llama-3.1-405b` — largest context (131K) but slowest

---

## Aurora-Provider: LLM7.io as Automatic Fallback

In Aurora-Provider, LLM7.io is already configured as priority 5 fallback for all agents. This means:

```
Request to "aurora-provider/coder"
  → Try OpenCode Zen / Big Pickle
  → Try Cloudflare / Kimi K2.6
  → Try OpenRouter / DeepSeek V4 Flash
  → Try Zhipu / GLM-4.7
  → Try Google Gemini
  → (all exhausted) → Try LLM7.io / DeepSeek R1 Distill ✓
```

Just ensure your Aurora-Provider `config/keys.json` has LLM7 configured:

```json
{
  "keys": {
    "llm7": ["unused"]
  }
}
```

That's it — no additional setup needed.

---

## Troubleshooting

**"2 RPM means I have to wait 30 seconds between requests"**
→ Yes. Use Aurora-Provider or rotate multiple API keys from other providers instead.

**"Can I get more requests without a key?"**
→ No, 2 RPM is the anonymous limit. Get a free token at https://token.llm7.io for higher limits (still slow, but documented).

**"Is it reliable?"**
→ Best-effort. Hosted on EU servers, GDPR-compliant, but not guaranteed uptime. Perfect as a last-resort fallback.

**"Can I use it with other tools (Cursor, Aider, etc.)?"**
→ Yes, any tool that accepts a custom base URL + API key will work with LLM7.io (`https://api.llm7.io/v1`).
