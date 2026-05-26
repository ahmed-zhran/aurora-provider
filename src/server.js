import express from "express";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Agent } from "undici";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── Config loading ───────────────────────────────────────────────────────────

function loadJSON(file) {
  return JSON.parse(readFileSync(join(ROOT, "config", file), "utf8"));
}

const PROVIDERS = loadJSON("providers.json").providers;
let AGENTS      = loadJSON("agents.json").agents;
let KEYS_CFG    = loadJSON("keys.json").keys;

// Load IPs configuration
let IPS = [];
try {
  IPS = loadJSON("ips.json").ips;
} catch (e) {
  IPS = [];
}

// Outbound agents cache for IP rotation
const outboundAgents = {};
function getAgentForIp(ip) {
  if (!ip) return undefined;
  if (!outboundAgents[ip]) {
    outboundAgents[ip] = new Agent({
      connect: {
        localAddress: ip
      }
    });
  }
  return outboundAgents[ip];
}

let ipIndex = 0;
function getNextIp() {
  if (!IPS || IPS.length === 0) return null;
  const ip = IPS[ipIndex];
  ipIndex = (ipIndex + 1) % IPS.length;
  return ip;
}

// ─── SSE Log Broadcaster ──────────────────────────────────────────────────────
const sseClients = [];
function broadcastLog(level, message) {
  const data = JSON.stringify({ timestamp: new Date().toISOString(), level, message });
  for (const res of sseClients) {
    res.write(`data: ${data}\n\n`);
  }
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args) => {
  originalLog(...args);
  broadcastLog("info", args.join(" "));
};
console.warn = (...args) => {
  originalWarn(...args);
  broadcastLog("warn", args.join(" "));
};
console.error = (...args) => {
  originalError(...args);
  broadcastLog("error", args.join(" "));
};

// ─── Rate-limit tracker ───────────────────────────────────────────────────────
// Tracks per-key health: { [providerKey]: { key, hitAt, cooldownUntil, failures } }

const keyState = {}; // Map<string, KeyState>

function makeKeyId(provider, keyIndex) {
  return `${provider}::${keyIndex}`;
}

function markKeyLimited(provider, keyIndex, cooldownMs = 60_000) {
  const id = makeKeyId(provider, keyIndex);
  keyState[id] = {
    hitAt: Date.now(),
    cooldownUntil: Date.now() + cooldownMs,
    failures: (keyState[id]?.failures ?? 0) + 1,
  };
  console.warn(`[aurora-provider] Key ${id} rate-limited for ${cooldownMs / 1000}s`);
}

function isKeyAvailable(provider, keyIndex) {
  const id = makeKeyId(provider, keyIndex);
  const state = keyState[id];
  if (!state) return true;
  if (Date.now() > state.cooldownUntil) {
    delete keyState[id]; // cooled down — reset
    return true;
  }
  return false;
}

function resetKey(provider, keyIndex) {
  delete keyState[makeKeyId(provider, keyIndex)];
}

// ─── Key rotation ─────────────────────────────────────────────────────────────

// Returns { key, keyIndex } or null if all keys exhausted
function getAvailableKey(providerName) {
  const keys = KEYS_CFG[providerName];
  if (!keys || keys.length === 0) return null;

  for (let i = 0; i < keys.length; i++) {
    if (isKeyAvailable(providerName, i)) {
      return { key: keys[i], keyIndex: i };
    }
  }
  return null; // all keys rate-limited
}

// ─── Request builder ──────────────────────────────────────────────────────────

function buildBaseUrl(providerName, keyEntry) {
  const prov = PROVIDERS[providerName];
  let url = prov.baseUrl;

  // Cloudflare needs accountId interpolated
  if (providerName === "cloudflare_workers_ai" && typeof keyEntry.key === "object") {
    url = url.replace("{ACCOUNT_ID}", keyEntry.key.accountId);
  }
  return url;
}

function buildAuthHeader(providerName, keyEntry) {
  const prov = PROVIDERS[providerName];
  const rawKey = typeof keyEntry.key === "object"
    ? keyEntry.key.apiToken
    : keyEntry.key;

  return {
    [prov.authHeader]: `${prov.authPrefix} ${rawKey}`,
  };
}

// ─── Proxy a single attempt ───────────────────────────────────────────────────

async function attemptRequest(providerName, modelId, body) {
  const keyEntry = getAvailableKey(providerName);
  if (!keyEntry) return { error: "ALL_KEYS_EXHAUSTED", providerName };

  const baseUrl = buildBaseUrl(providerName, keyEntry);
  const headers = {
    "Content-Type": "application/json",
    ...buildAuthHeader(providerName, keyEntry),
  };

  const payload = { ...body, model: modelId };

  // Outbound IP rotation connection agent
  const ip = getNextIp();
  const dispatcher = getAgentForIp(ip);
  if (ip) {
    console.log(`[aurora-provider] Routing request through outbound IP: ${ip}`);
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      dispatcher,
    });

    if (res.status === 429) {
      // Back-off: first failure = 60s, subsequent = scale up
      const failures = (keyState[makeKeyId(providerName, keyEntry.keyIndex)]?.failures ?? 0) + 1;
      const cooldown = Math.min(60_000 * failures, 900_000); // max 15 min
      markKeyLimited(providerName, keyEntry.keyIndex, cooldown);
      return { error: "RATE_LIMITED", providerName, modelId };
    }

    if (!res.ok) {
      const text = await res.text();
      console.error(`[aurora-provider] ${providerName}/${modelId} → HTTP ${res.status}: ${text}`);
      return { error: "HTTP_ERROR", status: res.status, providerName, modelId };
    }

    // Stream passthrough: return raw Response for streaming
    return { success: true, response: res, providerName, modelId };
  } catch (err) {
    console.error(`[aurora-provider] ${providerName}/${modelId} → Network error: ${err.message}`);
    return { error: "NETWORK_ERROR", providerName, modelId };
  }
}

// ─── Agent-aware dispatch with fallback chain ─────────────────────────────────

async function dispatch(agentName, body) {
  const agentConfig = AGENTS[agentName];
  if (!agentConfig) {
    return { error: `Unknown agent: ${agentName}` };
  }

  const chain = agentConfig.fallbacks;

  for (const step of chain) {
    const { provider, model } = step;

    // Check if provider has any keys configured
    const keys = KEYS_CFG[provider];
    if (!keys || keys.length === 0) {
      console.log(`[aurora-provider] Skipping ${provider} — no keys configured`);
      continue;
    }

    // Try all available keys for this provider
    let providerExhausted = false;
    while (true) {
      const result = await attemptRequest(provider, model, body);

      if (result.success) {
        console.log(`[aurora-provider] ✓ ${agentName} → ${provider}/${model}`);
        return result;
      }

      if (result.error === "ALL_KEYS_EXHAUSTED") {
        providerExhausted = true;
        break;
      }

      if (result.error === "RATE_LIMITED") {
        // Try next key (loop continues — getAvailableKey will skip this one)
        const nextKey = getAvailableKey(provider);
        if (!nextKey) {
          providerExhausted = true;
          break;
        }
        continue;
      }

      // HTTP error or network error — move to next fallback
      break;
    }

    if (providerExhausted) {
      console.warn(`[aurora-provider] ✗ ${provider} exhausted — trying next fallback`);
    }
  }

  return { error: "ALL_FALLBACKS_EXHAUSTED", agentName };
}

// ─── Model-name → agent resolver ──────────────────────────────────────────────
// OpenCode sends model names like "aurora-provider/build" or "auroraprovider/coder"
// We parse the suffix as the agent name.

function resolveAgent(modelId) {
  if (!modelId) return null;
  // Accepts: "aurora-provider/build", "auroraprovider/build", "ap/build", "build"
  const parts = modelId.split("/");
  const suffix = parts[parts.length - 1].toLowerCase();
  return AGENTS[suffix] ? suffix : null;
}

// ─── Express server ───────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "10mb" }));

// Serve UI
app.use(express.static(join(ROOT, "src", "public")));

// Config APIs
app.get("/api/config", (req, res) => {
  res.json({
    providers: PROVIDERS,
    agents: AGENTS,
    keys: KEYS_CFG,
    ips: IPS
  });
});

app.post("/api/keys", (req, res) => {
  try {
    const { keys } = req.body;
    // Clear and assign new keys
    for (const key of Object.keys(KEYS_CFG)) {
      delete KEYS_CFG[key];
    }
    Object.assign(KEYS_CFG, keys);
    
    writeFileSync(join(ROOT, "config", "keys.json"), JSON.stringify({
      _comment: "Aurora-Provider API keys store. Add multiple keys per provider — they will be rotated automatically on rate limit.",
      _security: "Keep this file out of version control. Add to .gitignore.",
      keys
    }, null, 2), "utf8");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/agents", (req, res) => {
  try {
    const { agents } = req.body;
    AGENTS = agents;
    writeFileSync(join(ROOT, "config", "agents.json"), JSON.stringify({
      _comment: "Aurora-Provider agent definitions. Each agent has an ordered fallback chain: provider + model pairs sorted by context size → rate limit generosity → speed.",
      _version: "1.0.0",
      agents
    }, null, 2), "utf8");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/ips", (req, res) => {
  try {
    const { ips } = req.body;
    IPS = ips;
    writeFileSync(join(ROOT, "config", "ips.json"), JSON.stringify({
      _comment: "IP rotation pool. Add local interface IP addresses here to route requests through different outbound IPs.",
      ips
    }, null, 2), "utf8");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logs stream (Server-Sent Events)
app.get("/api/logs-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.push(res);

  req.on("close", () => {
    const index = sseClients.indexOf(res);
    if (index !== -1) {
      sseClients.splice(index, 1);
    }
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "1.0.0", agents: Object.keys(AGENTS) });
});

// Key state dashboard
app.get("/status", (req, res) => {
  const summary = {};
  for (const [providerName, keys] of Object.entries(KEYS_CFG)) {
    if (!keys || keys.length === 0) continue;
    summary[providerName] = keys.map((_, i) => ({
      keyIndex: i,
      available: isKeyAvailable(providerName, i),
      state: keyState[makeKeyId(providerName, i)] ?? null,
    }));
  }
  res.json({ keyStates: summary, uptime: process.uptime() });
});

// List models — returns all agent names as fake "models"
app.get("/v1/models", (req, res) => {
  const models = Object.keys(AGENTS).map((name) => ({
    id: `aurora-provider/${name}`,
    object: "model",
    created: 1716000000,
    owned_by: "aurora-provider",
  }));
  res.json({ object: "list", data: models });
});

// Main completions endpoint
app.post("/v1/chat/completions", async (req, res) => {
  const { model, stream, ...rest } = req.body;

  const agentName = resolveAgent(model);
  if (!agentName) {
    return res.status(400).json({
      error: {
        message: `Unknown model/agent: "${model}". Available: ${Object.keys(AGENTS).map((a) => `aurora-provider/${a}`).join(", ")}`,
        type: "invalid_request_error",
      },
    });
  }

  const body = { ...rest, stream: stream ?? false };
  const result = await dispatch(agentName, body);

  if (result.error) {
    return res.status(503).json({
      error: {
        message: `Aurora-Provider: ${result.error} for agent "${agentName}"`,
        type: "service_unavailable",
      },
    });
  }

  // Pass response through
  const upstream = result.response;

  // Copy status and headers
  res.status(upstream.status);
  const ct = upstream.headers.get("content-type");
  if (ct) res.setHeader("Content-Type", ct);
  res.setHeader("X-Aurora-Provider", `${result.providerName}/${result.modelId}`);

  if (stream || (ct && ct.includes("text/event-stream"))) {
    // Stream passthrough
    for await (const chunk of upstream.body) {
      res.write(chunk);
    }
    res.end();
  } else {
    const data = await upstream.json();
    res.json(data);
  }
});

// ─── Background health probe (every 15 min) ───────────────────────────────────

async function probeAllKeys() {
  console.log("[aurora-provider] Running 15-min key health probe...");
  const testBody = {
    messages: [{ role: "user", content: "Reply with just the word OK." }],
    max_tokens: 5,
    stream: false,
  };

  for (const [providerName, provModels] of Object.entries(PROVIDERS)) {
    const keys = KEYS_CFG[providerName];
    if (!keys || keys.length === 0) continue;

    const firstModel = provModels.models?.[0]?.id;
    if (!firstModel) continue;

    for (let i = 0; i < keys.length; i++) {
      // Temporarily mark as available to test
      resetKey(providerName, i);
      const result = await attemptRequest(providerName, firstModel, testBody);
      if (result.success) {
        // Drain body to avoid leak
        await result.response.text().catch(() => {});
        console.log(`[probe] ✓ ${providerName} key[${i}]`);
      } else {
        console.log(`[probe] ✗ ${providerName} key[${i}]: ${result.error}`);
      }
    }
  }
}

const PROBE_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
setTimeout(() => {
  probeAllKeys();
  setInterval(probeAllKeys, PROBE_INTERVAL_MS);
}, 10_000); // first probe after 10s startup delay

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 4141;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`
╔══════════════════════════════════════════╗
║       Aurora-Provider  v1.0.0            ║
║  Local OpenAI-compatible LLM router      ║
╠══════════════════════════════════════════╣
║  Listening: http://127.0.0.1:${PORT}        ║
║  Agents:    ${Object.keys(AGENTS).join(", ").padEnd(30)}║
╚══════════════════════════════════════════╝
  `);
});
