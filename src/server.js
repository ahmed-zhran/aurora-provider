import express from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Agent, ProxyAgent } from "undici";
import dns from "dns";
import { execSync } from "child_process";
import { Database } from "bun:sqlite";

dns.setDefaultResultOrder("ipv4first");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const VAULT_DIR = join(ROOT, "vault");
if (!existsSync(VAULT_DIR)) {
  mkdirSync(VAULT_DIR, { recursive: true });
}

// Migrate configuration files to vault on boot
const configFiles = ["providers.json", "agents.json", "keys.json", "ips.json"];
for (const file of configFiles) {
  const dest = join(VAULT_DIR, file);
  if (!existsSync(dest)) {
    const src = join(ROOT, "config", file);
    if (existsSync(src)) {
      console.log(`[aurora-provider] Migrating ${file} to vault folder...`);
      try {
        writeFileSync(dest, readFileSync(src, "utf8"), "utf8");
      } catch (err) {
        console.error(`[aurora-provider] Error migrating ${file}: ${err.message}`);
      }
    } else {
      console.log(`[aurora-provider] Initializing empty ${file} in vault...`);
      let defaultVal = {};
      if (file === "keys.json") defaultVal = { keys: {} };
      else if (file === "agents.json") defaultVal = { agents: {} };
      else if (file === "providers.json") defaultVal = { providers: {} };
      else if (file === "ips.json") defaultVal = { ips: [] };
      writeFileSync(dest, JSON.stringify(defaultVal, null, 2), "utf8");
    }
  }
}

// ─── Database loading ─────────────────────────────────────────────────────────
const db = new Database(join(VAULT_DIR, "vault.db"));
db.run(`
  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
    agent TEXT,
    provider TEXT,
    model TEXT,
    key_index INTEGER,
    key_name TEXT,
    key_email TEXT,
    proxy TEXT,
    source TEXT,
    prompt TEXT,
    response TEXT,
    status TEXT,
    error_message TEXT,
    latency_ms INTEGER
  )
`);

// ─── Config loading ───────────────────────────────────────────────────────────

function loadJSON(file) {
  return JSON.parse(readFileSync(join(VAULT_DIR, file), "utf8"));
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

// ─── Proxy pool & testing ─────────────────────────────────────────────────────
let PROXY_POOL = []; // Array of { url, latency }
let proxyPoolIndex = 0;
let proxyStatus = "Idle"; // "Scraping...", "Testing...", "Active"

function getNextProxy() {
  if (!PROXY_POOL || PROXY_POOL.length === 0) return null;
  const activeLimit = Math.min(PROXY_POOL.length, 10);
  const proxy = PROXY_POOL[proxyPoolIndex % activeLimit];
  proxyPoolIndex = (proxyPoolIndex + 1) % activeLimit;
  return proxy.url;
}

// Scrape and test proxies
async function refreshProxyPool() {
  proxyStatus = "Scraping free proxies...";
  console.log(`[aurora-provider] ${proxyStatus}`);
  
  const sources = [
    "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
    "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt",
    "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks5.txt",
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=all&ssl=all&anonymity=all",
    "https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt",
    "https://raw.githubusercontent.com/B4RC0D37/proxy-list/main/SOCKS5.txt"
  ];
  
  const rawProxies = new Set();
  
  const fetchPromises = sources.map(async (url) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.split("\n");
      for (let line of lines) {
        line = line.trim();
        if (line && !line.startsWith("#")) {
          let ipPort = line;
          if (ipPort.includes("://")) {
            ipPort = ipPort.split("://")[1];
          }
          ipPort = ipPort.replace(/\/+$/, "").trim();
          if (ipPort.includes(":")) {
            rawProxies.add(`socks5://${ipPort}`);
          }
        }
      }
    } catch (err) {
      console.warn(`[aurora-provider] Failed to fetch proxy source ${url}: ${err.message}`);
    }
  });

  await Promise.all(fetchPromises);

  const list = Array.from(rawProxies);
  console.log(`[aurora-provider] Fetched ${list.length} unique proxies from all sources.`);
  
  if (list.length === 0) {
    proxyStatus = "Failed to fetch any proxies";
    return;
  }

  // Shuffle the list to randomize
  const shuffled = list.sort(() => Math.random() - 0.5);

  proxyStatus = "Testing proxy latencies...";
  console.log(`[aurora-provider] ${proxyStatus}`);

  const sample = shuffled.slice(0, 800);
  const results = [];
  
  const chunkSize = 20;
  for (let i = 0; i < sample.length; i += chunkSize) {
    if (results.length >= 100) break;
    const chunk = sample.slice(i, i + chunkSize);
    const promises = chunk.map(async (proxyUrl) => {
      const start = Date.now();
      try {
        const dispatcher = new ProxyAgent(proxyUrl);
        const res = await fetch("https://registry.npmjs.org/express", {
          method: "HEAD",
          dispatcher,
          signal: AbortSignal.timeout(3500)
        });
        if (res.ok) {
          results.push({ url: proxyUrl, latency: Date.now() - start });
        }
      } catch (err) {
        // failed or timed out
      }
    });
    await Promise.all(promises);
  }

  console.log(`[aurora-provider] Testing complete. Found ${results.length} working proxies.`);

  if (results.length === 0) {
    proxyStatus = "No working proxies found. Using direct connection.";
    PROXY_POOL = [];
    return;
  }

  results.sort((a, b) => a.latency - b.latency);
  PROXY_POOL = results.slice(0, 100);
  proxyPoolIndex = 0;
  proxyStatus = `Active (${PROXY_POOL.length} proxies)`;
  
  console.log("[aurora-provider] Selected active proxy pool:");
  PROXY_POOL.slice(0, 10).forEach((p, idx) => {
    console.log(`  [Proxy ${idx + 1}] ${p.url} (${p.latency}ms)`);
  });
  if (PROXY_POOL.length > 10) {
    console.log(`  ... and ${PROXY_POOL.length - 10} more warm proxies in standby pool.`);
  }
}

function removeDeadProxy(proxyUrl) {
  const index = PROXY_POOL.findIndex(p => p.url === proxyUrl);
  if (index !== -1) {
    console.warn(`[aurora-provider] Removing dead proxy from pool: ${proxyUrl}`);
    PROXY_POOL.splice(index, 1);
    if (proxyPoolIndex >= PROXY_POOL.length) {
      proxyPoolIndex = 0;
    }
    if (PROXY_POOL.length === 0) {
      proxyStatus = "No working proxies remaining. Using direct connection.";
    } else {
      proxyStatus = `Active (${PROXY_POOL.length} proxies)`;
    }
    
    if (PROXY_POOL.length < 15 && !proxyStatus.startsWith("Scraping") && !proxyStatus.startsWith("Testing")) {
      console.log(`[aurora-provider] Proxy pool low (${PROXY_POOL.length} remaining). Replenishing in background...`);
      refreshProxyPool().catch(err => {
        console.error(`[aurora-provider] Auto-replenish failed: ${err.message}`);
      });
    }
  }
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

// Returns { key, keyIndex, name, email } or null if all keys exhausted
function getAvailableKey(providerName) {
  const keys = KEYS_CFG[providerName];
  if (!keys || keys.length === 0) return null;

  for (let i = 0; i < keys.length; i++) {
    if (isKeyAvailable(providerName, i)) {
      const entry = keys[i];
      const keyVal = typeof entry === "object" && entry !== null && 'key' in entry ? entry.key : entry;
      const name = typeof entry === "object" && entry !== null && 'name' in entry ? entry.name : `Key ${i}`;
      const email = typeof entry === "object" && entry !== null && 'email' in entry ? entry.email : "";
      return { key: keyVal, keyIndex: i, name, email };
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

async function attemptRequest(providerName, modelId, body, forcedKeyIndex = null) {
  let keyEntry;
  if (forcedKeyIndex !== null) {
    const keys = KEYS_CFG[providerName];
    if (keys && keys[forcedKeyIndex]) {
      const entry = keys[forcedKeyIndex];
      const keyVal = typeof entry === "object" && entry !== null && 'key' in entry ? entry.key : entry;
      const name = typeof entry === "object" && entry !== null && 'name' in entry ? entry.name : `Key ${forcedKeyIndex}`;
      const email = typeof entry === "object" && entry !== null && 'email' in entry ? entry.email : "";
      keyEntry = { key: keyVal, keyIndex: forcedKeyIndex, name, email };
    }
  } else {
    keyEntry = getAvailableKey(providerName);
  }
  if (!keyEntry) return { error: "ALL_KEYS_EXHAUSTED", providerName };

  const baseUrl = buildBaseUrl(providerName, keyEntry);
  const headers = {
    "Content-Type": "application/json",
    ...buildAuthHeader(providerName, keyEntry),
  };

  const payload = { ...body, model: modelId };

  const maxProxyRetries = 3;
  let attempts = 0;

  while (attempts <= maxProxyRetries) {
    // Outbound routing: Prefer Proxy Pool first, then Outbound IP Rotation, then default connection
    let dispatcher;
    const proxyUrl = getNextProxy();
    const currentProxy = proxyUrl || "direct";
    if (proxyUrl) {
      console.log(`[aurora-provider] Routing request through proxy: ${proxyUrl} (attempt ${attempts + 1}/${maxProxyRetries + 1})`);
      dispatcher = new ProxyAgent(proxyUrl);
    } else {
      const ip = getNextIp();
      dispatcher = getAgentForIp(ip);
      if (ip) {
        console.log(`[aurora-provider] Routing request through outbound IP: ${ip}`);
      }
    }

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        dispatcher,
      });

      if (res.status === 429) {
        // If we used a proxy, it might be the proxy's IP that is rate-limited, not the key itself.
        if (proxyUrl && attempts < maxProxyRetries) {
          console.warn(`[aurora-provider] Proxy ${proxyUrl} rate-limited (HTTP 429). Evicting proxy and retrying key ${keyEntry.keyIndex} with another route...`);
          removeDeadProxy(proxyUrl);
          attempts++;
          continue;
        }

        // If we didn't use a proxy, or we exhausted all proxy retries, we assume the key itself is rate-limited.
        if (proxyUrl) {
          console.warn(`[aurora-provider] Exceeded proxy retries for rate limits. Evicting final proxy ${proxyUrl}.`);
          removeDeadProxy(proxyUrl);
        }
        const failures = (keyState[makeKeyId(providerName, keyEntry.keyIndex)]?.failures ?? 0) + 1;
        const provCfg = PROVIDERS[providerName];
        const customCooldownSec = provCfg?.cooldownTime;
        const cooldown = customCooldownSec
          ? customCooldownSec * 1000
          : Math.min(60_000 * failures, 900_000); // max 15 min default
        markKeyLimited(providerName, keyEntry.keyIndex, cooldown);
        return { error: "RATE_LIMITED", providerName, modelId, keyIndex: keyEntry.keyIndex, keyName: keyEntry.name, keyEmail: keyEntry.email, proxy: currentProxy };
      }

      if (!res.ok) {
        const text = await res.text();
        console.error(`[aurora-provider] ${providerName}/${modelId} → HTTP ${res.status}: ${text}`);
        
        if (proxyUrl && (res.status === 502 || res.status === 504 || res.status === 403)) {
          if (attempts < maxProxyRetries) {
            console.warn(`[aurora-provider] Proxy ${proxyUrl} failed with HTTP ${res.status}. Evicting proxy and retrying key ${keyEntry.keyIndex}...`);
            removeDeadProxy(proxyUrl);
            attempts++;
            continue;
          }
          removeDeadProxy(proxyUrl);
        }
        return { error: "HTTP_ERROR", status: res.status, providerName, modelId, keyIndex: keyEntry.keyIndex, keyName: keyEntry.name, keyEmail: keyEntry.email, proxy: currentProxy };
      }

      // Stream passthrough: return raw Response for streaming
      return { success: true, response: res, providerName, modelId, keyIndex: keyEntry.keyIndex, keyName: keyEntry.name, keyEmail: keyEntry.email, proxy: currentProxy };
    } catch (err) {
      console.error(`[aurora-provider] ${providerName}/${modelId} → Network error via proxy ${proxyUrl || "direct"}: ${err.message}`);
      
      if (proxyUrl) {
        if (attempts < maxProxyRetries) {
          console.warn(`[aurora-provider] Proxy ${proxyUrl} network error. Evicting proxy and retrying key ${keyEntry.keyIndex}...`);
          removeDeadProxy(proxyUrl);
          attempts++;
          continue;
        }
        removeDeadProxy(proxyUrl);
      }
      return { error: "NETWORK_ERROR", providerName, modelId, keyIndex: keyEntry.keyIndex, keyName: keyEntry.name, keyEmail: keyEntry.email, proxy: currentProxy };
    }
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
    
    writeFileSync(join(VAULT_DIR, "keys.json"), JSON.stringify({
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
    writeFileSync(join(VAULT_DIR, "agents.json"), JSON.stringify({
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
    writeFileSync(join(VAULT_DIR, "ips.json"), JSON.stringify({
      _comment: "IP rotation pool. Add local interface IP addresses here to route requests through different outbound IPs.",
      ips
    }, null, 2), "utf8");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Providers API
app.get("/api/providers", (req, res) => {
  res.json({ providers: PROVIDERS });
});

app.post("/api/providers", (req, res) => {
  try {
    const { providers } = req.body;
    
    // Clear and assign new providers
    for (const key of Object.keys(PROVIDERS)) {
      delete PROVIDERS[key];
    }
    Object.assign(PROVIDERS, providers);
    
    writeFileSync(join(VAULT_DIR, "providers.json"), JSON.stringify({
      _comment: "Aurora-Provider supported LLM providers catalog and models metadata.",
      providers
    }, null, 2), "utf8");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Usage statistics and logs query API
app.get("/api/usage", (req, res) => {
  try {
    const { startDate, endDate, agent, provider, source, status, page = 1, limit = 50 } = req.query;

    const clauses = [];
    const params = [];

    if (startDate) {
      clauses.push("timestamp >= ?");
      params.push(startDate + " 00:00:00");
    }
    if (endDate) {
      clauses.push("timestamp <= ?");
      params.push(endDate + " 23:59:59");
    }
    if (agent) {
      clauses.push("agent = ?");
      params.push(agent);
    }
    if (provider) {
      clauses.push("provider = ?");
      params.push(provider);
    }
    if (source) {
      clauses.push("source = ?");
      params.push(source);
    }
    if (status) {
      clauses.push("status = ?");
      params.push(status);
    }

    const where = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";

    // Summary Metrics
    const totalCount = db.prepare(`SELECT count(*) as count FROM usage_logs ${where}`).get(...params).count;
    
    const successWhere = clauses.length > 0 ? where + " AND status='Success'" : "WHERE status='Success'";
    const successCount = db.prepare(`SELECT count(*) as count FROM usage_logs ${successWhere}`).get(...params).count;
    
    const avgLatency = db.prepare(`
      SELECT avg(latency_ms) as avg 
      FROM usage_logs 
      ${successWhere} AND latency_ms > 0
    `).get(...params).avg || 0;

    // Paginated logs
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    const logsSql = `
      SELECT * FROM usage_logs 
      ${where} 
      ORDER BY id DESC 
      LIMIT ? OFFSET ?
    `;
    const paginatedLogs = db.prepare(logsSql).all(...params, limitNum, offset);

    // Stats for Charts
    const providersData = db.prepare(`
      SELECT provider, count(*) as count 
      FROM usage_logs 
      ${where} 
      GROUP BY provider
    `).all(...params);

    const modelsData = db.prepare(`
      SELECT model, count(*) as count 
      FROM usage_logs 
      ${where} 
      GROUP BY model
    `).all(...params);

    const sourcesData = db.prepare(`
      SELECT source, count(*) as count 
      FROM usage_logs 
      ${where} 
      GROUP BY source
    `).all(...params);

    const timeSql = `
      SELECT date(timestamp) as date, count(*) as count
      FROM usage_logs
      ${where}
      GROUP BY date(timestamp)
      ORDER BY date ASC
    `;
    const timeData = db.prepare(timeSql).all(...params);

    res.json({
      success: true,
      logs: paginatedLogs,
      totalCount,
      successCount,
      avgLatency: Math.round(avgLatency),
      stats: {
        providers: providersData,
        models: modelsData,
        sources: sourcesData,
        timeSeries: timeData
      }
    });
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

// Proxies API
app.get("/api/proxies", (req, res) => {
  res.json({
    status: proxyStatus,
    pool: PROXY_POOL
  });
});

app.post("/api/proxies/refresh", (req, res) => {
  refreshProxyPool().catch(err => {
    console.error(`[aurora-provider] Error refreshing proxy pool: ${err.message}`);
  });
  res.json({ success: true, message: "Proxy refresh started in background." });
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

function parseTextFromSse(sseData) {
  let text = "";
  let reasoning = "";
  const lines = sseData.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const delta = parsed.choices?.[0]?.delta;
        if (delta) {
          if (delta.content) text += delta.content;
          if (delta.reasoning_content) reasoning += delta.reasoning_content;
        }
      } catch (e) {
        // ignore malformed JSON
      }
    }
  }
  return reasoning ? `[Reasoning]\n${reasoning}\n\n[Content]\n${text}` : text;
}

// Main completions endpoint
app.post("/v1/chat/completions", async (req, res) => {
  const { model, stream, ...rest } = req.body;
  
  let source = req.headers["x-request-source"];
  if (!source) {
    const origin = req.headers["origin"] || req.headers["referer"];
    if (origin) {
      try {
        const url = new URL(origin);
        source = url.hostname;
      } catch (e) {
        source = origin;
      }
    } else {
      source = "API";
    }
  }

  const prompt = req.body.messages ? JSON.stringify(req.body.messages) : "";

  const agentName = resolveAgent(model);
  if (!agentName) {
    const errorMsg = `Unknown model/agent: "${model}". Available: ${Object.keys(AGENTS).map((a) => `aurora-provider/${a}`).join(", ")}`;
    
    // Log invalid request error to SQLite
    try {
      const stmt = db.prepare(`
        INSERT INTO usage_logs (
          agent, provider, model, key_index, key_name, key_email, proxy, source, prompt, response, status, error_message, latency_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(null, null, model, null, null, null, null, source, prompt, null, "Error", errorMsg, 0);
    } catch (err) {
      console.error("[aurora-provider] DB Error logging invalid model request:", err.message);
    }

    return res.status(400).json({
      error: {
        message: errorMsg,
        type: "invalid_request_error",
      },
    });
  }

  const start = Date.now();
  const body = { ...rest, stream: stream ?? false };
  const result = await dispatch(agentName, body);

  if (result.error) {
    const latency = Date.now() - start;
    
    // Log dispatch error to SQLite
    try {
      const stmt = db.prepare(`
        INSERT INTO usage_logs (
          agent, provider, model, key_index, key_name, key_email, proxy, source, prompt, response, status, error_message, latency_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(agentName, result.providerName || null, result.modelId || null, result.keyIndex !== undefined ? result.keyIndex : null, result.keyName || null, result.keyEmail || null, result.proxy || null, source, prompt, null, "Error", result.error, latency);
    } catch (err) {
      console.error("[aurora-provider] DB Error logging dispatch error:", err.message);
    }

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
    let fullResponseText = "";
    // Stream passthrough
    for await (const chunk of upstream.body) {
      res.write(chunk);
      fullResponseText += chunk.toString();
    }
    res.end();

    const latency = Date.now() - start;
    const cleanResponse = parseTextFromSse(fullResponseText);
    
    // Log successful stream request to SQLite
    try {
      const stmt = db.prepare(`
        INSERT INTO usage_logs (
          agent, provider, model, key_index, key_name, key_email, proxy, source, prompt, response, status, error_message, latency_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(agentName, result.providerName, result.modelId, result.keyIndex, result.keyName, result.keyEmail, result.proxy, source, prompt, cleanResponse, "Success", null, latency);
    } catch (err) {
      console.error("[aurora-provider] DB Error logging stream success:", err.message);
    }
  } else {
    try {
      const data = await upstream.json();
      res.json(data);

      const latency = Date.now() - start;
      const responseText = data.choices?.[0]?.message?.content || "";

      // Log successful JSON request to SQLite
      const stmt = db.prepare(`
        INSERT INTO usage_logs (
          agent, provider, model, key_index, key_name, key_email, proxy, source, prompt, response, status, error_message, latency_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(agentName, result.providerName, result.modelId, result.keyIndex, result.keyName, result.keyEmail, result.proxy, source, prompt, responseText, "Success", null, latency);
    } catch (err) {
      console.error("[aurora-provider] Error parsing JSON upstream or DB log:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to parse upstream JSON response" });
      }
    }
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
      const result = await attemptRequest(providerName, firstModel, testBody, i);
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

const PORT = process.env.PORT ?? 8550;
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
  refreshProxyPool().catch(err => {
    console.error(`[aurora-provider] Error on initial proxy load: ${err.message}`);
  });
});
