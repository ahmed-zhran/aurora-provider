<p align="center">
  <h1 align="center">🌌 Aurora-Provider</h1>
  <p align="center">
    <strong>The Self-Hosted Ultra-Provider Gateway. Expose rotated keys, proxy pools, and free provider fallback chains as OpenAI-compatible "Auras".</strong>
  </p>
  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js"></a>
    <a href="https://bun.sh"><img src="https://img.shields.io/badge/bun-compatible-f472b6" alt="Bun compatible"></a>
    <a href="https://github.com/ahmed-zhran/aurora-provider/stargazers"><img src="https://img.shields.io/github/stars/ahmed-zhran/aurora-provider?style=social" alt="GitHub stars"></a>
  </p>
</p>

---

Aurora-Provider is an **ultra-provider gateway** designed for single-user self-hosting. It allows you to define unlimited **Auras** (virtual OpenAI-compatible models) backed by complex, automated fallback chains. You will never have to pay for LLMs, write complex model switching logic, or manage API keys in your daily coding tools again.

### 🌟 Key Advertising: The Aura Hub
- **Create Your Aura**: Define virtual endpoints in the **Aura Hub** (e.g. `coder`, `scribe`, `plan`). Each Aura acts as a drop-in OpenAI-compatible model (like `aurora-provider/coder`) for your coding agents or IDE extensions.
- **Provider Fallback Chains**: If the primary model or provider is rate-limited, Aurora-Provider instantly and transparently switches to the next fallback option in the chain.
- **Multi-Key API Rotation**: Add multiple free-tier API keys per provider. Aurora automatically rotates keys on rate-limits (429) and cools them down.
- **Proxy Pooling (IP Masking)**: Bypasses IP-bound rate limiting by routing requests through a dynamically harvested and tested SOCKS5 proxy pool.
- **Beautiful Analytics Dashboard**: Real-time request log inspection, token metrics, latency charts, and live key status views with 5 premium themes.

---

## ⚡ Quick Start

```bash
# 1. Clone
git clone https://github.com/ahmed-zhran/aurora-provider.git
cd aurora-provider

# 2. Install dependencies
bun install    # or: npm install

# 3. Configure API keys
cp vault/keys.example.json vault/keys.json
# Edit vault/keys.json with your API keys (see "Getting API Keys" below)

# 4. Start the gateway
bun run start  # or: npm start
```

You should see:

```
╔══════════════════════════════════════════╗
║          Aurora-Provider  v1.0.0         ║
║  Local OpenAI-compatible LLM router     ║
║  Listening: http://127.0.0.1:8550       ║
║  Auras:     plan, build, coder, ...     ║
╚══════════════════════════════════════════╝
```

- **Dashboard UI**: [http://127.0.0.1:8550](http://127.0.0.1:8550)
- **OpenAI-Compatible Endpoint**: `http://127.0.0.1:8550/v1`

---

## 🤔 How It Works

```
Cursor / Aider / Continue / Any Coding Agent
  │
  │  POST /v1/chat/completions
  │  model: "aurora-provider/coder"
  ▼
┌─────────────────────────────────────────────────────┐
│                   Aurora-Provider                   │
│                                                     │
│  1. Resolve model name → Aura ("coder")             │
│  2. Load fallback chain from auras.json             │
│  3. For each (provider, model) in chain:            │
│     a. Get next available key (skip rate-limited)   │
│     b. Route through SOCKS5 proxy pool (IP Masking) │
│     c. Forward request to provider API              │
│     d. On 429 → rotate key → rotate proxy → retry   │
│     e. All keys exhausted → next provider           │
│  4. Return upstream response (streaming supported)  │
│                                                     │
│  Background: proxy pool auto-refresh + key probing  │
└─────────────────────────────────────────────────────┘
  │
  ├── Google AI Studio → gemini-2.5-flash (1M context)
  ├── Groq             → llama-3.3-70b (ultra fast)
  ├── Cloudflare AI    → kimi-k2.6 (262K context)
  ├── OpenRouter       → 30+ free models
  ├── Zhipu            → GLM-4.7-flash (200K context)
  └── ... (and other free providers)
```

### Two-Layer Resiliency

1. **Key Rotation**: Multiple keys per provider are rotated sequentially. If `key[0]` hits a rate limit, it is put on cooldown and `key[1]` is tried.
2. **Provider Failover**: If all keys for `google_ai_studio` are rate-limited, the request falls back down the Aura's chain to `groq` or `cloudflare_workers_ai` instantly.

---

## 📊 Dashboard

Aurora-Provider includes a premium self-hosted dashboard supporting **5 visual themes** (Deep Space, Light Mode, Cyberpunk, Aurora, Ocean):

- **Dashboard Tab**: KPI metric cards (success rates, average latencies, token counters), line charts, and paginated request logs.
- **API Tester Tab**: Select an Aura and run test queries directly in the web UI.
- **Aura Hub**: Add, rename, or delete Auras and customize their provider/model fallback order using simple control buttons.
- **API Keys & Health**: Monitor live cooldown timers and add multiple keys per provider.
- **Proxy Pool**: Check SOCKS5 pool sizes, adjust latency thresholds, or force-refill the harvester.
- **Provider Config**: Edit base URLs, custom model list mappings, and cooldown timings.

---

## 🛠️ Configuration

Aurora-Provider persists configuration under the `vault/` directory:

### API Keys (`vault/keys.json`)
Add credentials to increase rate limits. Providers with no keys configured are automatically skipped in the fallback loop:
```json
{
  "keys": {
    "google_ai_studio": ["AIza-key1", "AIza-key2"],
    "groq": ["gsk_key1"],
    "openrouter": ["sk-or-key-here"],
    "cloudflare_workers_ai": [
      { "apiToken": "cf-token-here", "accountId": "cf-account-id-here" }
    ],
    "opencode_zen": ["zen-key-here"]
  }
}
```

### Aura Definitions (`vault/auras.json`)
Exposes virtual models. You can add unlimited custom Auras:
```json
{
  "auras": {
    "coder": {
      "fallbacks": [
        { "provider": "google_ai_studio", "model": "gemini-2.5-flash" },
        { "provider": "groq", "model": "llama-3.3-70b-specdec" },
        { "provider": "openrouter", "model": "deepseek/deepseek-r1:free" }
      ]
    }
  }
}
```

---

## 🌐 Supported Free Providers

All supported providers offer completely free tiers (no credit cards required):

- [**Google AI Studio**](https://aistudio.google.com) — Gemini 2.5 Flash (1M context, 1500 req/day)
- [**Groq**](https://console.groq.com) — Llama 3.3 70B, DeepSeek R1 (Ultra fast, 1000 req/day)
- [**Cloudflare Workers AI**](https://dash.cloudflare.com) — Kimi, Qwen, DeepSeek, Llama (10K neurons/day)
- [**OpenRouter**](https://openrouter.ai) — Dozens of free models (rotated by OpenRouter)
- [**OpenCode Zen**](https://opencode.ai/zen) — Big Pickle, DeepSeek V4 Flash (200K context, generous limits)
- [**Cerebras**](https://cloud.cerebras.ai) — Llama 3.3 70B (1M tokens/day)
- [**NVIDIA NIM**](https://build.nvidia.com) — Extensive catalog of models (~5 RPM)
- [**GitHub Models**](https://github.com/marketplace/models) — Grok 3, Llama 3.3 (Fast free limits)
- [**Kimi (Moonshot)**](https://platform.moonshot.cn) — Kimi K2.5 (3 RPM)

---

## 🔌 Integration Examples

Aurora-Provider is a drop-in replacement for OpenAI. Configure your development tools as follows:

### Cursor (`Settings -> Models`)
1. Turn off all default models.
2. Under **Override OpenAI Base URL**, enter: `http://127.0.0.1:8550/v1`
3. Enter any random string for the API key.
4. Add your custom Aura name (e.g. `coder` or `aurora-provider/coder`) as a new model.

### Continue (`.continue/config.json`)
```json
{
  "models": [
    {
      "title": "Aurora Coder",
      "provider": "openai",
      "model": "aurora-provider/coder",
      "apiBase": "http://127.0.0.1:8550/v1"
    }
  ]
}
```

### Python SDK
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8550/v1",
    api_key="aurora-local"  # ignored, but required
)

response = client.chat.completions.create(
    model="aurora-provider/coder",
    messages=[{"role": "user", "content": "Explain binary search."}]
)
print(response.choices[0].message.content)
```

---

## 📖 Extended Documentation
- [Architecture & Flow Details](docs/architecture.md)
- [Web Dashboard Guide](docs/dashboard.md)
- [API Route Reference](docs/api-reference.md)
- [Provider Setup Guide](docs/providers-guide.md)

---

## 🤝 Contributing
Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License
This project is licensed under the [MIT License](LICENSE).
