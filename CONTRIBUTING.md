# Contributing to Aurora-Provider

First off, **thank you** for considering contributing to Aurora-Provider! 🎉

Whether you're fixing a bug, adding a new LLM provider, improving documentation, or suggesting a feature — every contribution makes Aurora-Provider better for everyone.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Features](#suggesting-features)
  - [Adding a New LLM Provider](#adding-a-new-llm-provider)
  - [Adding a New Agent](#adding-a-new-agent)
  - [Improving Documentation](#improving-documentation)
- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Security](#security)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior as described in that document.

---

## How Can I Contribute?

### Reporting Bugs

Found something broken? We'd love to know about it.

1. **Search existing issues** first to avoid duplicates.
2. **Open a new issue** using the [Bug Report template](https://github.com/ahmed-zhran/aurora-provider/issues/new?template=bug_report.yml).
3. Include as much detail as possible:
   - Steps to reproduce the issue
   - Expected vs. actual behavior
   - Your environment (Node.js/Bun version, OS)
   - Relevant logs or error messages (redact any API keys!)

> **⚠️ Never include API keys, tokens, or secrets in bug reports or logs.**

### Suggesting Features

Have an idea for a new feature or improvement?

1. **Search existing issues** to see if it's already been suggested.
2. **Open a new issue** using the [Feature Request template](https://github.com/ahmed-zhran/aurora-provider/issues/new?template=feature_request.yml).
3. Describe the problem you're trying to solve, your proposed solution, and any alternatives you've considered.

### Adding a New LLM Provider

One of the best ways to contribute is adding support for a new free LLM provider. Here's how:

#### Step 1: Add the provider definition

Edit `vault/providers.json` and add a new entry with the provider's configuration:

```json
{
  "id": "your_provider_id",
  "name": "Your Provider Name",
  "baseUrl": "https://api.example.com/v1",
  "models": [
    {
      "id": "model-name",
      "name": "Model Display Name",
      "contextWindow": 128000,
      "maxOutputTokens": 8192
    }
  ]
}
```

Key fields to research and include:
- **`baseUrl`** — The OpenAI-compatible API endpoint
- **`models`** — All free models offered, with context window and output limits
- Rate limits (RPM, RPD, TPD) if documented
- Any special authentication format (e.g., Cloudflare needs `apiToken` + `accountId`)

#### Step 2: Add keys to `vault/keys.json`

Add your test API keys under the provider's ID:

```json
{
  "keys": {
    "your_provider_id": [
      "your-api-key-1",
      "your-api-key-2"
    ]
  }
}
```

> **⚠️ Do NOT commit `vault/keys.json`** — it is gitignored for a reason.

#### Step 3: Add to agent fallback chains

Edit `vault/agents.json` and add the new provider + model to relevant agents' fallback chains. Place it according to the fallback priority guidelines:

1. **Context size** (largest first)
2. **Rate limit generosity** (unlimited/daily > RPM-limited)
3. **Speed** (fastest as last resort)

#### Step 4: Test and restart

```bash
bun run dev   # or: npm run dev
```

Test with a simple completion request:

```bash
curl http://127.0.0.1:8550/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer aurora-provider-local" \
  -d '{
    "model": "aurora-provider/coder",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 100
  }'
```

Verify that:
- The provider responds correctly
- Key rotation works on 429 errors
- Fallback to the next provider works when all keys are exhausted

### Adding a New Agent

Agents are named routing profiles (like `plan`, `build`, `coder`) with their own fallback chains.

#### Step 1: Add agent entry to `vault/agents.json`

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "fallbacks": [
    { "provider": "opencode_zen", "model": "big-pickle" },
    { "provider": "google_ai_studio", "model": "gemini-2.5-flash" }
  ]
}
```

#### Step 2: Restart Aurora-Provider

```bash
bun run dev   # or: npm run dev
```

### Improving Documentation

Documentation improvements are always welcome! This includes:
- Fixing typos or unclear instructions
- Adding examples
- Improving the README
- Translating documentation

---

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or [Node.js](https://nodejs.org/) >= 18.0.0
- Git

### Getting Started

```bash
# 1. Fork and clone the repository
git clone https://github.com/<your-username>/aurora-provider.git
cd aurora-provider

# 2. Install dependencies
bun install        # or: npm install

# 3. Set up your API keys
cp vault/keys.example.json vault/keys.json
# Edit vault/keys.json and add your API keys

# 4. Start the development server (with file watching)
bun run dev        # or: npm run dev
```

The server will start at `http://127.0.0.1:8550`.

### Useful Endpoints for Development

| Endpoint | Description |
|---|---|
| `GET /health` | Quick health check |
| `GET /status` | Key states, cooldowns, uptime |
| `GET /v1/models` | List all registered agents |
| `POST /v1/chat/completions` | Main completions endpoint |

---

## Code Style

Aurora-Provider follows these conventions:

- **ES Modules** — The project uses `"type": "module"` in `package.json`. Use `import`/`export`, not `require()`.
- **Single server file** — All routing logic lives in `src/server.js`. Keep it that way unless there's a strong reason to split.
- **Hono framework** — We use [Hono](https://hono.dev/) for HTTP routing. Follow Hono patterns for adding endpoints.
- **Configuration over code** — Providers, agents, and keys are defined in JSON files under `vault/`. Adding a new provider or agent should **not** require changes to `src/server.js`.
- **No transpilation** — The code runs directly on Bun or Node.js without a build step.
- **Descriptive variable names** — Prefer clarity over brevity.
- **Console logging** — Use `console.log` / `console.error` with descriptive prefixes (e.g., `[Aurora]`, `[KeyRotation]`).

---

## Pull Request Process

### 1. Fork & Branch

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/<your-username>/aurora-provider.git
cd aurora-provider
git checkout -b feat/my-awesome-feature    # or: fix/some-bug
```

Use a descriptive branch name with a prefix:
- `feat/` — New features or providers
- `fix/` — Bug fixes
- `docs/` — Documentation changes
- `refactor/` — Code refactoring

### 2. Make Your Changes

- Keep changes focused — one feature or fix per PR.
- Test your changes locally with `bun run dev`.
- Make sure the server starts without errors.

### 3. Commit

Write clear, concise commit messages:

```
feat: add SambaNova provider with Llama 3.3 70B

- Add provider definition to vault/providers.json
- Add to coder and explore fallback chains
- Document rate limits and free tier details
```

### 4. Push & Open a PR

```bash
git push origin feat/my-awesome-feature
```

Then open a Pull Request on GitHub against the `main` branch. Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md) — it will guide you through what to include.

### 5. Review

- A maintainer will review your PR and may request changes.
- Please respond to review feedback promptly.
- Once approved, your PR will be merged. 🎉

---

## Security

> **🔒 Never commit `vault/keys.json`, `.env` files, or any API keys/tokens.**

The `vault/keys.json` file is listed in `.gitignore` and must stay that way. If you accidentally commit secrets:

1. **Immediately revoke** the exposed keys with the respective provider.
2. Notify the maintainers.
3. Use `git filter-branch` or [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) to remove them from Git history.

Before submitting a PR, double-check:
```bash
git diff --cached | grep -i "key\|token\|secret\|password"
```

---

## Questions?

If you have questions that aren't covered here, feel free to [open a discussion](https://github.com/ahmed-zhran/aurora-provider/issues) or reach out to the maintainers.

**Thank you for helping make Aurora-Provider better!** ✨
