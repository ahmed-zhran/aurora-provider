# Providers Guide

> How to get API keys from each provider, free tier details, rate limits, and comparison table.

[← Back to README](../README.md) · [Architecture](architecture.md) · [Dashboard](dashboard.md) · [API Reference](api-reference.md)

---

## Table of Contents

- [Provider Comparison Table](#provider-comparison-table)
- [Getting API Keys](#getting-api-keys)
  - [Google AI Studio](#google-ai-studio)
  - [Groq](#groq)
  - [OpenRouter](#openrouter)
  - [Zhipu (Z.AI)](#zhipu-zai)
  - [Cloudflare Workers AI](#cloudflare-workers-ai)
  - [OpenCode Zen](#opencode-zen)
  - [Cerebras](#cerebras)
  - [Kimi (Moonshot)](#kimi-moonshot)
  - [GitHub Models](#github-models)
  - [NVIDIA NIM](#nvidia-nim)
- [Deprecated Providers](#deprecated-providers)
- [Key Configuration Format](#key-configuration-format)
- [Tips](#tips)

---

## Provider Comparison Table

| Provider | Free Models | Context | Rate Limits | Speed | Permanent |
|---|---|---|---|---|---|
| **Google AI Studio** | Gemini 2.5 Flash, Flash-Lite | 1M | 30 RPM / 1500 RPD | Fast | Yes |
| **Groq** | Llama 3.3 70B, Llama 4 Scout, DeepSeek R1 | 128K–512K | 30 RPM / 1K RPD | Ultra fast | Yes |
| **OpenRouter (free)** | DeepSeek V4 Flash, Qwen3 235B, Kimi K2.6, Llama 4 Maverick | 1M / 262K | ~20 RPM | Medium | No |
| **Zhipu (Z.AI)** | GLM-4.7 Flash, GLM-4.5 Flash | 200K | 1 concurrent req | Fast | Yes ✓ |
| **Cloudflare Workers AI** | Kimi K2.6, Qwen3, DeepSeek R1, Llama 4 | 262K / 512K | 10K neurons/day | Medium | Yes |
| **OpenCode Zen** | Big Pickle, DeepSeek V4 Flash, Nemotron 3 | 200K | Generous (undocumented) | Medium | No (limited time) |
| **Cerebras** | Llama 3.3 70B, Llama 4 Scout | 8K–131K | 1M tok/day | Ultra fast | Yes |
| **Kimi (Moonshot)** | Kimi K2.5 | 262K | 3 RPM / 1.5M TPD | Medium | No |
| **GitHub Models** | Grok 3, Llama 3.3 70B, 45+ | 128K | 8K in / 4K out | Fast | Yes |
| **NVIDIA NIM** | Kimi K2, DeepSeek V3.2, Nemotron 3 | 32K–262K | ~5 RPM | Fast | No |

**Legend:**
- **RPM** = Requests per minute
- **RPD** = Requests per day
- **TPD** = Tokens per day
- **Permanent** = Whether the free tier is expected to remain free long-term

---

## Getting API Keys

### Google AI Studio

| | |
|---|---|
| **Signup URL** | [https://aistudio.google.com](https://aistudio.google.com) |
| **Free Tier** | 30 RPM, 1,500 RPD, 1M context window |
| **Key Format** | `AIza...` |
| **Permanent** | ✅ Yes |

**Steps:**
1. Go to [Google AI Studio](https://aistudio.google.com)
2. Sign in with your Google account
3. Click **Get API Key** in the top navigation
4. Click **Create API Key** and select or create a Google Cloud project
5. Copy the generated API key (starts with `AIza`)
6. Add to `vault/keys.json` under `google_ai_studio`

> **Tip:** This is the best free tier available — 1M context window and 1,500 requests/day. Create multiple Google accounts for more keys.

---

### Groq

| | |
|---|---|
| **Signup URL** | [https://console.groq.com](https://console.groq.com) |
| **Free Tier** | 30 RPM, 1,000 RPD, no credit card needed |
| **Key Format** | `gsk_...` |
| **Permanent** | ✅ Yes |

**Steps:**
1. Go to [Groq Console](https://console.groq.com)
2. Sign up with Google, GitHub, or email
3. Navigate to **API Keys** in the left sidebar
4. Click **Create API Key**
5. Copy the key (starts with `gsk_`)
6. Add to `vault/keys.json` under `groq`

> **Tip:** Groq provides ultra-fast inference. No credit card required for the free tier.

---

### OpenRouter

| | |
|---|---|
| **Signup URL** | [https://openrouter.ai](https://openrouter.ai) |
| **Free Tier** | ~20 RPM, access to all `:free` models |
| **Key Format** | `sk-or-v1-...` |
| **Permanent** | ⚠️ No (free models may be removed) |

**Steps:**
1. Go to [OpenRouter](https://openrouter.ai)
2. Sign up with Google, GitHub, or email
3. Navigate to **Keys** in your account settings
4. Click **Create Key**
5. Copy the key (starts with `sk-or-v1-`)
6. Add to `vault/keys.json` under `openrouter`

> **Tip:** A single OpenRouter key gives access to all models tagged `:free`. Look for models ending in `:free` in the model list.

---

### Zhipu (Z.AI)

| | |
|---|---|
| **Signup URL** | [https://open.bigmodel.cn](https://open.bigmodel.cn) |
| **Free Tier** | 1 concurrent request, GLM-4.7-Flash permanently free |
| **Key Format** | Long alphanumeric string |
| **Permanent** | ✅ Yes |

**Steps:**
1. Go to [Zhipu Open Platform](https://open.bigmodel.cn)
2. Sign up with email (Chinese interface — use browser translation)
3. Navigate to **API Keys** section in the console
4. Create a new API key
5. Copy the key
6. Add to `vault/keys.json` under `zhipu`

> **Tip:** GLM-4.7-Flash is permanently free with 200K context. The rate limit is 1 concurrent request, so having a single key is usually enough.

---

### Cloudflare Workers AI

| | |
|---|---|
| **Signup URL** | [https://dash.cloudflare.com](https://dash.cloudflare.com) |
| **Free Tier** | 10,000 neurons/day |
| **Key Format** | Object with `apiToken` and `accountId` |
| **Permanent** | ✅ Yes |

**Steps:**
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) and create an account
2. Find your **Account ID** on the dashboard overview page (right sidebar)
3. Go to **My Profile** → **API Tokens**
4. Click **Create Token**
5. Use the **Workers AI** template, or create a custom token with `Workers AI: Read` permission
6. Copy the generated API token
7. Add to `vault/keys.json` under `cloudflare_workers_ai` as an object:

```json
{
  "cloudflare_workers_ai": [
    { "apiToken": "YOUR_CF_API_TOKEN", "accountId": "YOUR_CF_ACCOUNT_ID" }
  ]
}
```

> **Note:** Cloudflare Workers AI requires both an API token and your account ID, unlike other providers that use a single key string.

---

### OpenCode Zen

| | |
|---|---|
| **Signup URL** | [https://opencode.ai/zen](https://opencode.ai/zen) |
| **Free Tier** | Generous (undocumented limits) |
| **Key Format** | Provider-specific key |
| **Permanent** | ⚠️ No (limited time offer) |

**Steps:**
1. Go to [OpenCode](https://opencode.ai/zen)
2. Obtain your Zen API key from the platform/dashboard
3. Add the key to `vault/keys.json` under `opencode_zen`

> **Tip:** OpenCode Zen offers generous rate limits with access to powerful models like Big Pickle and DeepSeek V4 Flash. However, this is a limited-time free offering.

---

### Cerebras

| | |
|---|---|
| **Signup URL** | [https://cloud.cerebras.ai](https://cloud.cerebras.ai) |
| **Free Tier** | 1M tokens/day |
| **Key Format** | Standard API key |
| **Permanent** | ✅ Yes |

**Steps:**
1. Go to [Cerebras Cloud](https://cloud.cerebras.ai)
2. Sign up with Google or email
3. Navigate to **API Keys** in the dashboard
4. Create a new API key
5. Copy the key
6. Add to `vault/keys.json` under `cerebras`

> **Warning:** Free tier context window is limited to 8K tokens on some models. Ultra-fast inference but smaller context compared to other providers.

---

### Kimi (Moonshot)

| | |
|---|---|
| **Signup URL** | [https://platform.moonshot.cn](https://platform.moonshot.cn) |
| **Free Tier** | 3 RPM, 1.5M tokens/day |
| **Key Format** | Standard API key |
| **Permanent** | ⚠️ No |

**Steps:**
1. Go to [Moonshot Platform](https://platform.moonshot.cn)
2. Sign up (may require a Chinese phone number)
3. Navigate to the API key management section
4. Create a new API key
5. Copy the key
6. Add to `vault/keys.json` under `kimi`

> **Note:** Registration may require a Chinese phone number for verification.

---

### GitHub Models

| | |
|---|---|
| **Signup URL** | [https://github.com/marketplace/models](https://github.com/marketplace/models) |
| **Free Tier** | 8K input / 4K output tokens, 45+ models |
| **Key Format** | GitHub personal access token (`ghp_...` or `github_pat_...`) |
| **Permanent** | ✅ Yes |

**Steps:**
1. Go to [GitHub Models Marketplace](https://github.com/marketplace/models)
2. You need a GitHub account (free)
3. Go to **Settings** → **Developer settings** → **Personal access tokens**
4. Generate a new token (classic or fine-grained)
5. No special scopes are needed for GitHub Models
6. Copy the token
7. Add to `vault/keys.json` under `github_models`

> **Tip:** You can use your existing GitHub personal access token — no special permissions required.

---

### NVIDIA NIM

| | |
|---|---|
| **Signup URL** | [https://build.nvidia.com](https://build.nvidia.com) |
| **Free Tier** | ~5 RPM, 94+ models |
| **Key Format** | `nvapi-...` |
| **Permanent** | ⚠️ No |

**Steps:**
1. Go to [NVIDIA Build](https://build.nvidia.com)
2. Sign up with an NVIDIA account (phone verification may be required)
3. Browse the model catalog and select a model
4. Click **Get API Key** or navigate to your account API keys
5. Generate and copy the API key (starts with `nvapi-`)
6. Add to `vault/keys.json` under `nvidia_nim`

> **Note:** Phone verification may be required during signup.

---

## Deprecated Providers

| Provider | Status | Notes |
|----------|--------|-------|
| ~~**Chutes AI**~~ | ❌ No longer free | Ended free tier in February 2026. Now requires paid credits. |

---

## Key Configuration Format

All keys are stored in `vault/keys.json`. Here's the structure:

```json
{
  "keys": {
    "google_ai_studio": ["AIza-key1", "AIza-key2"],
    "groq": ["gsk_key1", "gsk_key2"],
    "openrouter": ["sk-or-key1"],
    "zhipu": ["your-zhipu-key"],
    "cloudflare_workers_ai": [
      { "apiToken": "your-cf-token", "accountId": "your-account-id" }
    ],
    "opencode_zen": ["sk-zen-key1"],
    "cerebras": ["your-cerebras-key"],
    "kimi": ["your-kimi-key"],
    "github_models": ["ghp_your-github-token"],
    "nvidia_nim": ["nvapi-your-nvidia-key"]
  }
}
```

See [`vault/keys.example.json`](../vault/keys.example.json) for a ready-to-copy template.

**Important:**
- Providers with no keys configured are **automatically skipped** in the fallback chain
- You don't need all providers — even just `google_ai_studio` + `groq` + `opencode_zen` gives solid coverage
- Add **multiple keys per provider** to increase your effective rate limit through key rotation
- ⚠️ **Never commit `keys.json` to version control** — it's already in `.gitignore`

---

## Tips

1. **Start with 3 providers** — Google AI Studio, Groq, and OpenRouter give excellent coverage with minimal setup
2. **Create multiple accounts** for providers that allow it (especially Google AI Studio) to get more keys
3. **Monitor key health** from the Dashboard's [API Keys & Health tab](dashboard.md#api-keys--health-tab) to see which keys are cooling down
4. **Adjust cooldown times** per provider in the [Provider Config tab](dashboard.md#provider-config-tab) if the defaults don't match the actual rate limits
5. **Use the SOCKS5 proxy pool (Beta)** to bypass IP-level rate limits — some providers rate-limit by IP address

---

*Aurora-Provider — Self-hosted multi-provider LLM routing with zero vendor lock-in.*
