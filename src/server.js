import { Hono } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { bodyLimit } from "hono/body-limit";
import { stream, streamSSE } from "hono/streaming";
import { getConnInfo } from "hono/bun";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fetch as undiciFetch } from "undici";
import { socksDispatcher } from "fetch-socks";
import dns from "dns";
import { Database } from "bun:sqlite";

dns.setDefaultResultOrder("ipv4first");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const VAULT_DIR = join(ROOT, "vault");
if (!existsSync(VAULT_DIR)) {
  mkdirSync(VAULT_DIR, { recursive: true });
}

// Migrate configuration files to vault on boot
const configFiles = ["providers.json", "auras.json", "keys.json", "model_settings.json"];
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
      else if (file === "auras.json") defaultVal = { auras: {} };
      else if (file === "providers.json") defaultVal = { providers: {} };
      writeFileSync(dest, JSON.stringify(defaultVal, null, 2), "utf8");
    }
  }
}

// ─── Database loading ─────────────────────────────────────────────────────────
const db = new Database(join(VAULT_DIR, "vault.db"));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA cache_size = -8000');
db.run = function (sql) {
  return this.exec(sql);
};
db.run(`
  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
    aura TEXT,
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
    latency_ms INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    request_host TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS proxy_refresh_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_cause TEXT,
    triggered_time DATETIME DEFAULT (datetime('now', 'localtime')),
    active_before INTEGER,
    status TEXT,
    running_time REAL,
    harvested_count INTEGER,
    tested_count INTEGER DEFAULT 0,
    passed_anomality_stage_count INTEGER
  )
`);

// Safe column migrations for existing databases
try {
  const columns = db.prepare("PRAGMA table_info(usage_logs)").all();
  const columnNames = columns.map(c => c.name);

  const migrations = [
    { name: "aura", type: "TEXT" },
    { name: "prompt_tokens", type: "INTEGER" },
    { name: "completion_tokens", type: "INTEGER" },
    { name: "total_tokens", type: "INTEGER" },
    { name: "request_host", type: "TEXT" }
  ];

  for (const col of migrations) {
    if (!columnNames.includes(col.name)) {
      console.log(`[aurora-provider] Migrating: Adding column ${col.name} to usage_logs`);
      db.run(`ALTER TABLE usage_logs ADD COLUMN ${col.name} ${col.type}`);
    }
  }

  // Backfill aura column from legacy agent column if agent exists
  if (columnNames.includes("agent") && columnNames.includes("aura")) {
    db.run("UPDATE usage_logs SET aura = agent WHERE aura IS NULL OR aura = ''");
  }
} catch (err) {
  console.error("[aurora-provider] Error running database migrations:", err.message);
}

// Migrate proxy_refresh_logs for tested_count
try {
  const columns = db.prepare("PRAGMA table_info(proxy_refresh_logs)").all();
  const columnNames = columns.map(c => c.name);
  if (!columnNames.includes("tested_count")) {
    console.log("[aurora-provider] Migrating: Adding column tested_count to proxy_refresh_logs");
    db.run("ALTER TABLE proxy_refresh_logs ADD COLUMN tested_count INTEGER DEFAULT 0");
  }
} catch (err) {
  console.error("[aurora-provider] Error running database migrations for proxy_refresh_logs:", err.message);
}

// Startup Stuck Proxy Fix: Reset stuck running proxy refresh logs to failed/interrupted on boot
try {
  db.run("UPDATE proxy_refresh_logs SET status = 'failed/interrupted' WHERE status = 'running'");
  console.log("[aurora-provider] Reset stuck running proxy refresh logs to 'failed/interrupted'");
} catch (err) {
  console.error("[aurora-provider] Failed to reset stuck proxy refresh logs:", err.message);
}

// ─── Database indexes ─────────────────────────────────────────────────────────
db.run('CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_logs(timestamp)');
db.run('CREATE INDEX IF NOT EXISTS idx_usage_status ON usage_logs(status)');
db.run('DROP INDEX IF EXISTS idx_usage_agent');
db.run('CREATE INDEX IF NOT EXISTS idx_usage_aura ON usage_logs(aura)');
db.run('CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_logs(provider)');
db.run('CREATE INDEX IF NOT EXISTS idx_usage_proxy ON usage_logs(proxy)');

// ─── Prepared statement cache ─────────────────────────────────────────────────
const stmts = {
  insertUsageLog: db.prepare(`
    INSERT INTO usage_logs (
      aura, provider, model, key_index, key_name, key_email, proxy, source, prompt, response, status, error_message, latency_ms,
      prompt_tokens, completion_tokens, total_tokens, request_host
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertProxyRefreshLog: db.prepare(`
    INSERT INTO proxy_refresh_logs (trigger_cause, active_before, status)
    VALUES (?, ?, ?)
  `),
  updateProxyRefreshProgress: db.prepare(`
    UPDATE proxy_refresh_logs
    SET harvested_count = ?,
        tested_count = ?,
        passed_anomality_stage_count = ?
    WHERE id = ?
  `),
  updateProxyRefreshDone: db.prepare(`
    UPDATE proxy_refresh_logs
    SET status = 'done',
        running_time = ?,
        harvested_count = ?,
        tested_count = ?,
        passed_anomality_stage_count = ?
    WHERE id = ?
  `),
  deleteUsageLogs: db.prepare('DELETE FROM usage_logs'),
  selectProxyRefreshHistory: db.prepare('SELECT * FROM proxy_refresh_logs ORDER BY id DESC LIMIT 50'),
  deleteProxyRefreshLogs: db.prepare('DELETE FROM proxy_refresh_logs'),
  selectDistinctHosts: db.prepare(`
    SELECT DISTINCT request_host
    FROM usage_logs
    WHERE request_host IS NOT NULL AND request_host != ''
  `),
  countMaskedRequests: db.prepare("SELECT count(*) as count FROM usage_logs WHERE proxy IS NOT NULL AND proxy != '' AND proxy != 'direct'"),
  countSuccessMaskedRequests: db.prepare("SELECT count(*) as count FROM usage_logs WHERE proxy IS NOT NULL AND proxy != '' AND proxy != 'direct' AND status = 'Success'"),
  countDirectRequests: db.prepare("SELECT count(*) as count FROM usage_logs WHERE proxy IS NULL OR proxy = '' OR proxy = 'direct'"),
};

// ─── Config loading ───────────────────────────────────────────────────────────

function loadJSON(file) {
  return JSON.parse(readFileSync(join(VAULT_DIR, file), "utf8"));
}

const PROVIDERS = loadJSON("providers.json").providers;
let AURAS       = loadJSON("auras.json").auras;
let KEYS_CFG    = loadJSON("keys.json").keys;

// ─── Model cache and dynamic fetching helpers ─────────────────────────────────
const MODELS_CACHE = {};
const MODEL_SETTINGS_FILE = join(VAULT_DIR, "model_settings.json");
let _modelSettingsCache = null;

function loadModelSettings() {
  if (_modelSettingsCache !== null) return _modelSettingsCache;
  try {
    if (existsSync(MODEL_SETTINGS_FILE)) {
      _modelSettingsCache = JSON.parse(readFileSync(MODEL_SETTINGS_FILE, "utf8"));
      return _modelSettingsCache;
    }
  } catch (e) {
    console.error("[aurora-provider] Failed to load model_settings.json:", e.message);
  }
  _modelSettingsCache = {};
  return _modelSettingsCache;
}

function saveModelSettings(settings) {
  _modelSettingsCache = settings;
  try {
    writeFileSync(MODEL_SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
  } catch (e) {
    console.error("[aurora-provider] Failed to save model_settings.json:", e.message);
  }
}

function getHeuristicMetadata(providerId, modelId) {
  const idL = modelId.toLowerCase();
  
  let contextWindow = 128000;
  let maxOutput = 4096;
  let reasoning = false;
  let capabilities = ["text"];
  
  // 1. Modalities / Capabilities
  if (idL.includes("vision") || 
      idL.includes("-vl") || 
      idL.includes("multimodal") || 
      idL.includes("image") || 
      idL.includes("video") || 
      idL.includes("audio") || 
      idL.includes("gpt-4o") ||
      idL.includes("gemini") ||
      idL.includes("claude-3-5")) {
    capabilities = ["text", "image"];
    if (idL.includes("video") || idL.includes("gemini")) {
      capabilities.push("video");
    }
    if (idL.includes("audio") || idL.includes("gemini") || idL.includes("gpt-4o") || idL.includes("claude")) {
      capabilities.push("audio");
    }
  }
  
  // 2. Reasoning support
  if (idL.includes("reasoner") || 
      idL.includes("reasoning") || 
      idL.includes("thinking") || 
      idL.includes("qwq") || 
      idL.includes("o1") || 
      idL.includes("o3") || 
      idL.includes("deepseek-r1") || 
      idL.includes("-r1")) {
    reasoning = true;
  }
  
  // 3. Context & Max Output limits
  if (idL.includes("gemini-2.5-pro") || idL.includes("gemini-1.5-pro")) {
    contextWindow = 2000000;
    maxOutput = 8192;
  } else if (idL.includes("gemini-2.5-flash") || idL.includes("gemini-1.5-flash") || idL.includes("gemini-3.1-flash-lite")) {
    contextWindow = 1000000;
    maxOutput = 8192;
  } else if (idL.includes("gemma")) {
    contextWindow = 1000000;
    maxOutput = 8192;
  } else if (idL.includes("claude-3-5")) {
    contextWindow = 200000;
    maxOutput = 8192;
  } else if (idL.includes("claude-3")) {
    contextWindow = 200000;
    maxOutput = 4096;
  } else if (idL.includes("gpt-4o") || idL.includes("gpt-4-turbo")) {
    contextWindow = 128000;
    maxOutput = 4096;
  } else if (idL.includes("llama-3.3") || idL.includes("llama-3.1")) {
    contextWindow = 128000;
    maxOutput = 4096;
  } else if (idL.includes("llama-3") || idL.includes("llama3")) {
    contextWindow = 8192;
    maxOutput = 2048;
  } else if (idL.includes("deepseek-chat") || idL.includes("deepseek-v3")) {
    contextWindow = 64000;
    maxOutput = 8192;
  } else if (idL.includes("deepseek-reasoner") || idL.includes("deepseek-r1")) {
    contextWindow = 64000;
    maxOutput = 8192;
  } else if (idL.includes("glm-4")) {
    contextWindow = 128000;
    maxOutput = 4096;
  } else if (idL.includes("qwen")) {
    contextWindow = 32000;
    maxOutput = 4096;
  }
  
  return { contextWindow, maxOutput, reasoning, capabilities };
}

function mapApiModel(providerId, apiModel, markFreeMap) {
  const modelId = apiModel.id;
  const markFreeKey = `${providerId}:${modelId}`;
  
  const heuristics = getHeuristicMetadata(providerId, modelId);
  
  let name = apiModel.name || apiModel.id.split("/").pop() || apiModel.id;
  
  let contextWindow = apiModel.context_length || apiModel.contextWindow || heuristics.contextWindow;
  if (apiModel.top_provider && apiModel.top_provider.context_length) {
    contextWindow = apiModel.top_provider.context_length;
  }
  
  let maxOutput = heuristics.maxOutput;
  if (apiModel.top_provider && apiModel.top_provider.max_completion_tokens) {
    maxOutput = apiModel.top_provider.max_completion_tokens;
  }
  
  let reasoning = heuristics.reasoning;
  if (apiModel.supported_parameters && (apiModel.supported_parameters.includes("reasoning") || apiModel.supported_parameters.includes("include_reasoning"))) {
    reasoning = true;
  }
  if (apiModel.reasoning !== undefined) {
    reasoning = !!apiModel.reasoning;
  }

  let capabilities = heuristics.capabilities;
  if (apiModel.architecture && apiModel.architecture.input_modalities) {
    capabilities = [...apiModel.architecture.input_modalities];
  }

  let pricing = apiModel.pricing || null;
  
  let isFreeDefault = false;
  if (pricing && parseFloat(pricing.prompt) === 0 && parseFloat(pricing.completion) === 0) {
    isFreeDefault = true;
  }
  if (modelId.includes(":free")) {
    isFreeDefault = true;
  }
  
  const staticProv = PROVIDERS[providerId];
  if (staticProv && staticProv.models) {
    const staticModel = staticProv.models.find(m => m.id === modelId);
    if (staticModel && staticModel.free) {
      isFreeDefault = true;
    }
  }

  const markFree = markFreeMap[markFreeKey] !== undefined ? !!markFreeMap[markFreeKey].markFree : isFreeDefault;

  return {
    id: modelId,
    name,
    contextWindow,
    maxOutput,
    reasoning,
    capabilities,
    pricing,
    markFree
  };
}

async function getModelsForProvider(providerId, forceRefresh = false) {
  if (!forceRefresh && MODELS_CACHE[providerId]) {
    const markFreeMap = loadModelSettings();
    return MODELS_CACHE[providerId].map(model => {
      const markFreeKey = `${providerId}:${model.id}`;
      return {
        ...model,
        markFree: markFreeMap[markFreeKey] !== undefined ? !!markFreeMap[markFreeKey].markFree : model.markFree
      };
    });
  }

  const keys = KEYS_CFG[providerId];
  const markFreeMap = loadModelSettings();

  if (!keys || keys.length === 0) {
    const staticModels = PROVIDERS[providerId]?.models || [];
    let settingsChanged = false;
    const mapped = staticModels.map(m => {
      const model = mapApiModel(providerId, m, markFreeMap);
      const markFreeKey = `${providerId}:${model.id}`;
      if (model.markFree && markFreeMap[markFreeKey] === undefined) {
        markFreeMap[markFreeKey] = { markFree: true };
        settingsChanged = true;
      }
      return model;
    });
    if (settingsChanged) {
      saveModelSettings(markFreeMap);
    }
    return mapped;
  }

  try {
    const keyEntry = keys[0];
    const keyVal = typeof keyEntry === "object" && keyEntry !== null && 'key' in keyEntry ? keyEntry.key : keyEntry;
    const name = typeof keyEntry === "object" && keyEntry !== null && 'name' in keyEntry ? keyEntry.name : `Key 0`;
    const email = typeof keyEntry === "object" && keyEntry !== null && 'email' in keyEntry ? keyEntry.email : "";
    const activeKeyEntry = { key: keyVal, keyIndex: 0, name, email };

    const baseUrl = buildBaseUrl(providerId, activeKeyEntry);
    const headers = {
      "Content-Type": "application/json",
      ...buildAuthHeader(providerId, activeKeyEntry)
    };

    const response = await undiciFetch(`${baseUrl}/models`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(6000)
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const data = await response.json();
    let apiModels = [];
    if (data && Array.isArray(data.data)) {
      apiModels = data.data;
    } else if (data && Array.isArray(data)) {
      apiModels = data;
    }

    if (apiModels.length === 0) {
      throw new Error("No models returned by API");
    }

    let settingsChanged = false;
    const mapped = apiModels.map(m => {
      const model = mapApiModel(providerId, m, markFreeMap);
      const markFreeKey = `${providerId}:${model.id}`;
      if (model.markFree && markFreeMap[markFreeKey] === undefined) {
        markFreeMap[markFreeKey] = { markFree: true };
        settingsChanged = true;
      }
      return model;
    });
    if (settingsChanged) {
      saveModelSettings(markFreeMap);
    }

    MODELS_CACHE[providerId] = mapped;
    return mapped;

  } catch (err) {
    console.warn(`[aurora-provider] Failed to fetch models dynamically for ${providerId}: ${err.message}. Falling back to static config.`);
    const staticModels = PROVIDERS[providerId]?.models || [];
    let settingsChanged = false;
    const mapped = staticModels.map(m => {
      const model = mapApiModel(providerId, m, markFreeMap);
      const markFreeKey = `${providerId}:${model.id}`;
      if (model.markFree && markFreeMap[markFreeKey] === undefined) {
        markFreeMap[markFreeKey] = { markFree: true };
        settingsChanged = true;
      }
      return model;
    });
    if (settingsChanged) {
      saveModelSettings(markFreeMap);
    }
    return mapped;
  }
}

// ─── Proxy pool & testing ─────────────────────────────────────────────────────
let PROXY_POOL = []; // Array of { url, latency, source, successCount, failureCount }
const PROXY_MAP = new Map(); // Map of url -> proxyObj for O(1) lookup
let proxyStatus = "Idle"; // "Scraping...", "Testing...", "Active"
let proxyPoolIndex = 0;
let isRefreshingProxyPool = false;

const ACTIVE_PROXIES_FILE = join(VAULT_DIR, "active_proxies.json");
let saveProxiesTimeout = null;

function saveActiveProxiesToDisk() {
  if (saveProxiesTimeout) return;
  saveProxiesTimeout = setTimeout(() => {
    saveProxiesTimeout = null;
    try {
      writeFileSync(ACTIVE_PROXIES_FILE, JSON.stringify(PROXY_POOL, null, 2), "utf8");
    } catch (e) {
      console.error("[aurora-provider] Failed to persist active proxies:", e.message);
    }
  }, 250);
}

function loadActiveProxiesFromDisk() {
  try {
    if (existsSync(ACTIVE_PROXIES_FILE)) {
      const data = JSON.parse(readFileSync(ACTIVE_PROXIES_FILE, "utf8"));
      if (Array.isArray(data)) {
        PROXY_POOL = data;
        PROXY_MAP.clear();
        for (const p of PROXY_POOL) {
          PROXY_MAP.set(p.url, p);
        }
        proxyStatus = `Active (${PROXY_POOL.length} proxies loaded from disk)`;
        console.log(`[aurora-provider] Loaded ${PROXY_POOL.length} active proxies from disk.`);
      }
    }
  } catch (e) {
    console.error("[aurora-provider] Failed to load active proxies from disk:", e.message);
  }
}

// Initial load from disk at boot
loadActiveProxiesFromDisk();
const dispatcherCache = new Map(); // Cache SOCKS dispatchers to avoid re-creation

let SERVER_PUBLIC_IP = "";

function getProxyDispatcher(proxyUrl) {
  const cached = dispatcherCache.get(proxyUrl);
  if (cached) return cached;
  try {
    const url = new URL(proxyUrl);
    const host = url.hostname;
    const port = parseInt(url.port);
    const options = {
      type: 5,
      host,
      port
    };
    if (url.username) {
      options.userId = decodeURIComponent(url.username);
    }
    if (url.password) {
      options.password = decodeURIComponent(url.password);
    }
    const dispatcher = socksDispatcher(options, {
      connect: {
        timeout: 2500
      }
    });
    dispatcherCache.set(proxyUrl, dispatcher);
    // Evict oldest if cache grows too large
    if (dispatcherCache.size > 250) {
      const firstKey = dispatcherCache.keys().next().value;
      dispatcherCache.delete(firstKey);
    }
    return dispatcher;
  } catch (e) {
    console.error(`[aurora-provider] Failed to parse proxy URL: ${proxyUrl}`, e.message);
    return null;
  }
}

async function detectServerPublicIp() {
  const providers = [
    { url: "https://checkip.amazonaws.com", format: "text" },
    { url: "https://api.my-ip.io/ip.json", format: "json" },
    { url: "https://ipinfo.io/json", format: "json" }
  ];
  for (const p of providers) {
    try {
      const res = await fetch(p.url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        if (p.format === "text") {
          SERVER_PUBLIC_IP = (await res.text()).trim();
        } else {
          const data = await res.json();
          SERVER_PUBLIC_IP = data.ip;
        }
        console.log(`[aurora-provider] Detected server public IP: ${SERVER_PUBLIC_IP} using ${p.url}`);
        return;
      }
    } catch (e) {
      console.warn(`[aurora-provider] Failed to detect IP using ${p.url}: ${e.message}`);
    }
  }
}

let PROXY_LATENCY_THRESHOLD = 1500; // default 1500ms
let ENABLE_PROXY = true;
try {
  const settingsPath = join(VAULT_DIR, "settings.json");
  if (existsSync(settingsPath)) {
    const s = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (s.latencyThreshold !== undefined) {
      PROXY_LATENCY_THRESHOLD = Math.max(100, Number(s.latencyThreshold));
    }
    if (s.enableProxy !== undefined) {
      ENABLE_PROXY = !!s.enableProxy;
    }
  }
} catch (e) {
  console.warn("[aurora-provider] Failed to load settings.json:", e.message);
}

const TARGET_COUNTRIES = ["TR", "GR", "CY", "NL", "DE", "FR", "SA", "AE"];

const COUNTRY_NAME_MAP = {
  IT: "italy",
  TR: "turkey",
  GR: "greece",
  CY: "cyprus",
  NL: "netherlands",
  DE: "germany",
  FR: "france",
  GB: "united-kingdom",
  ES: "spain",
  SA: "saudi-arabia",
  AE: "united-arab-emirates",
  US: "united-states",
  SG: "singapore",
  MX: "mexico"
};

const PROXY_SOURCES = [
  // Github RAW files (static, bulk lists of SOCKS5 proxies)
  "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
  "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt",
  "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks5.txt",
  "https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt",
  "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/socks5.txt",
  "https://raw.githubusercontent.com/rdavydov/proxy-list/main/proxies/socks5.txt",
  "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt",
  "https://raw.githubusercontent.com/proxygenerator1/ProxyGenerator/main/MostStable/socks5.txt",
  "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks5.txt",
  "https://raw.githubusercontent.com/Ian-Lusule/Proxies/main/proxies/socks5.txt",
  "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt",
  "https://raw.githubusercontent.com/Tsprnay/Proxy-lists/master/proxies/socks5.txt",
  "https://raw.githubusercontent.com/komutan234/Proxy-List-Free/main/proxies/socks5.txt",
  "https://raw.githubusercontent.com/r00tee/Proxy-List/main/Socks5.txt",
  "https://raw.githubusercontent.com/vmheaven/VMHeaven-Free-Proxy-Updated/main/socks5.txt",
  "https://raw.githubusercontent.com/Thordata/awesome-free-proxy-list/main/proxies/socks5.txt",
  "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/socks5.txt",
  "https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks5.txt",
  "https://raw.githubusercontent.com/prxchk/proxy-list/main/socks5.txt",
  "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/socks5.txt",
  "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt",

  // Static web list / provider landing pages
  "https://www.webshare.io/features/free-proxy",
  "https://oxylabs.io/products/free-proxies",
  "https://sockslist.us/",
  "https://aimultiple.com/free-socks5-proxies",
  "https://gologin.com/proxies/free-proxies/",

  // 1. Geonode SOCKS5 Free API - Pagination + Anonymity levels (first 5 pages + country filtered pages)
  ...Array.from({ length: 5 }, (_, i) => `https://proxylist.geonode.com/api/proxy-list?protocols=socks5&limit=100&page=${i + 1}&sort_by=lastChecked&sort_type=desc`),
  ...Array.from({ length: 5 }, (_, i) => `https://proxylist.geonode.com/api/proxy-list?protocols=socks5&limit=100&page=${i + 1}&sort_by=lastChecked&sort_type=desc&anonymityLevel=elite`),
  ...Array.from({ length: 5 }, (_, i) => `https://proxylist.geonode.com/api/proxy-list?protocols=socks5&limit=100&page=${i + 1}&sort_by=lastChecked&sort_type=desc&anonymityLevel=anonymous`),

  // Country-specific pages (2 pages of general + 1 page of elite + 1 page of anonymous per near/fast country)
  ...TARGET_COUNTRIES.flatMap(country => [
    `https://proxylist.geonode.com/api/proxy-list?protocols=socks5&limit=100&page=1&sort_by=lastChecked&sort_type=desc&country=${country}`,
    `https://proxylist.geonode.com/api/proxy-list?protocols=socks5&limit=100&page=2&sort_by=lastChecked&sort_type=desc&country=${country}`,
    `https://proxylist.geonode.com/api/proxy-list?protocols=socks5&limit=100&page=1&sort_by=lastChecked&sort_type=desc&country=${country}&anonymityLevel=elite`,
    `https://proxylist.geonode.com/api/proxy-list?protocols=socks5&limit=100&page=1&sort_by=lastChecked&sort_type=desc&country=${country}&anonymityLevel=anonymous`
  ]),

  // 2. Proxyscrape API calls with varying country and anonymity filters
  "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=all&ssl=all&anonymity=all",
  "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=all&ssl=all&anonymity=anonymous",
  "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=all&ssl=all&anonymity=elite",
  ...TARGET_COUNTRIES.flatMap(country => [
    `https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=${country}&ssl=all&anonymity=all`,
    `https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=${country}&ssl=all&anonymity=anonymous`,
    `https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=${country}&ssl=all&anonymity=elite`
  ]),

  // 3. Databay API - General limit + target country list pages
  "https://databay.com/api/v1/proxy-list?format=json&limit=200",
  ...TARGET_COUNTRIES.map(c => `https://databay.com/api/v1/proxy-list?format=json&limit=100&country=${c}`),

  // 4. Flamingoproxies SOCKS5 landing pages
  "https://flamingoproxies.com/free-proxies/china?q=&protocol=socks5&anonymity=&per_page=50",
  ...TARGET_COUNTRIES.flatMap(c => {
    const name = COUNTRY_NAME_MAP[c];
    return name ? [
      `https://flamingoproxies.com/free-proxies/${name}?q=&protocol=socks5&anonymity=&per_page=50`,
      `https://flamingoproxies.com/free-proxies/${name}?q=&protocol=socks5&anonymity=elite&per_page=50`,
      `https://flamingoproxies.com/free-proxies/${name}?q=&protocol=socks5&anonymity=anonymous&per_page=50`
    ] : [];
  }),

  // 5. Freeproxy.world SOCKS5 country-specific & anonymity-specific pages
  "https://www.freeproxy.world/?type=socks5",
  "https://www.freeproxy.world/?type=socks5&anonymity=anonymous",
  "https://www.freeproxy.world/?type=socks5&anonymity=elite",
  ...TARGET_COUNTRIES.flatMap(c => [
    `https://www.freeproxy.world/?type=socks5&country=${c}`,
    `https://www.freeproxy.world/?type=socks5&country=${c}&anonymity=anonymous`,
    `https://www.freeproxy.world/?type=socks5&country=${c}&anonymity=elite`
  ]),

  // 6. Spys.one SOCKS5 country & city landing pages
  "https://spys.one/en/socks-proxy-list/",
  ...TARGET_COUNTRIES.map(c => `https://spys.one/free-proxy-list/${c}/`),
  ...["Falkenstein", "Frankfurt", "Amsterdam", "Paris", "London", "Milan", "Istanbul"].flatMap(city =>
    Array.from({ length: 3 }, (_, i) => `https://spys.one/proxy-city/${city}/${i + 1}/`)
  ),

  // 7. Proxynova country SOCKS5 pages
  ...TARGET_COUNTRIES.map(c => `https://www.proxynova.com/proxy-server-list/country-${c.toLowerCase()}`),

  // 8. Proxy5 country landing pages
  ...TARGET_COUNTRIES.flatMap(c => {
    const name = COUNTRY_NAME_MAP[c];
    return name ? [`https://proxy5.net/free-proxy/${name}`] : [];
  }),

  // 9. Litport country landing pages
  ...["france", "germany", "netherlands", "turkey", "united-states", "greece"].map(c => `https://litport.net/free-proxy/${c}`),

  // 10. Free.geonix.com country landing pages
  ...TARGET_COUNTRIES.flatMap(c => {
    const name = COUNTRY_NAME_MAP[c];
    return name ? [`https://free.geonix.com/en/${name}/`] : [];
  })
];

const SOURCE_STATS = {};
for (const src of PROXY_SOURCES) {
  SOURCE_STATS[src] = { success: 0, failure: 0, totalLatency: 0 };
}

let lastRequestTime = Date.now();

function getNextProxy() {
  if (!ENABLE_PROXY) return null;

  // Pre-use pool health check: if pool is below 50% of max capacity and no refresh
  // is running, trigger one in the background. This catches the empty-pool-on-boot
  // case where the on-start refresh was killed before completion.
  const PROXIES_MAX_LIMIT = 200;
  if (PROXY_POOL.length < (PROXIES_MAX_LIMIT / 2) && !isRefreshingProxyPool) {
    console.log(`[aurora-provider] Pool health check: ${PROXY_POOL.length}/${PROXIES_MAX_LIMIT} proxies. Triggering background refresh...`);
    refreshProxyPool("pool_health_check", true).catch(err => {
      console.error(`[aurora-provider] Pool health check refresh failed: ${err.message}`);
    });
  }

  if (!PROXY_POOL || PROXY_POOL.length === 0) return null;
  const activeLimit = Math.min(PROXY_POOL.length, 10);
  const proxy = PROXY_POOL[proxyPoolIndex % activeLimit];
  proxyPoolIndex = (proxyPoolIndex + 1) % activeLimit;
  return proxy.url;
}

// Scrape and test proxies
let lastAutoRefreshTime = 0;

// O(log N) binary search index finder for insertion
function binarySearchInsertionIndex(array, latency) {
  let low = 0;
  let high = array.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (array[mid].latency === latency) {
      return mid;
    } else if (array[mid].latency < latency) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

// O(log N) binary search index finder for removal/update
function findIndexBinary(array, url, latency) {
  let low = 0;
  let high = array.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (array[mid].latency === latency) {
      if (array[mid].url === url) return mid;
      // Resolve latency collisions by scanning adjacent items
      let left = mid - 1;
      while (left >= 0 && array[left].latency === latency) {
        if (array[left].url === url) return left;
        left--;
      }
      let right = mid + 1;
      while (right < array.length && array[right].latency === latency) {
        if (array[right].url === url) return right;
        right++;
      }
      return -1;
    } else if (array[mid].latency < latency) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return -1;
}

// Sliding window promise concurrency queue (exactly 'limit' concurrent runs)
async function concurrentMap(array, limit, mapperFn) {
  const results = [];
  const executing = new Set();
  for (const item of array) {
    const p = Promise.resolve().then(() => mapperFn(item));
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

function insertIntoSortedPool(pool, proxyObj, maxLimit = 200) {
  const oldProxy = PROXY_MAP.get(proxyObj.url);
  if (oldProxy) {
    if (proxyObj.latency < oldProxy.latency) {
      const idx = findIndexBinary(pool, proxyObj.url, oldProxy.latency);
      if (idx !== -1) {
        pool.splice(idx, 1);
      }
    } else {
      return; // Existing proxy is already faster/same
    }
  }

  const insertIdx = binarySearchInsertionIndex(pool, proxyObj.latency);
  pool.splice(insertIdx, 0, proxyObj);
  PROXY_MAP.set(proxyObj.url, proxyObj);

  if (pool.length > maxLimit) {
    const removed = pool.pop();
    PROXY_MAP.delete(removed.url);
  }
  saveActiveProxiesToDisk();
}

async function refreshProxyPool(triggerCause = "replenishing", bypassCooldown = true) {
  if (!ENABLE_PROXY) {
    console.log("[aurora-provider] Proxy usage is disabled. Skipping proxy pool refresh.");
    return;
  }
  if (isRefreshingProxyPool) {
    console.log("[aurora-provider] Proxy refresh already in progress. Skipping.");
    return;
  }

  if (!bypassCooldown) {
    const timeSinceLast = Date.now() - lastAutoRefreshTime;
    if (timeSinceLast < 60 * 60 * 1000) { // 1 hour minimum
      console.log(`[aurora-provider] Auto-refresh skipped. Only ${Math.round(timeSinceLast / 60000)} minutes since last refresh (minimum 1 hour).`);
      return;
    }
    lastAutoRefreshTime = Date.now();
  }

  isRefreshingProxyPool = true;
  proxyStatus = "Refreshing proxy pool...";
  console.log(`[aurora-provider] ${proxyStatus} (Sequential harvesting + testing) [Cause: ${triggerCause}]`);

  const startTime = Date.now();
  const activeBefore = PROXY_POOL.length;
  let logId = null;

  try {
    const info = stmts.insertProxyRefreshLog.run(triggerCause, activeBefore, "running");
    logId = info.lastInsertRowid;
  } catch (dbErr) {
    console.error("[aurora-provider] Failed to log refresh startup to DB:", dbErr.message);
  }

  let totalHarvested = 0;
  let totalTested = 0;
  let totalPassedAnomality = 0;

  try {
    const seenProxies = new Set();
    const shuffledSources = [...PROXY_SOURCES].sort(() => Math.random() - 0.5);
    const domainLastFetch = new Map();

    for (let sIdx = 0; sIdx < shuffledSources.length; sIdx++) {
      const url = shuffledSources[sIdx];
      
      try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const lastFetch = domainLastFetch.get(domain) || 0;
        const delayNeeded = 2500 - (Date.now() - lastFetch);
        if (delayNeeded > 0) {
          await new Promise(resolve => setTimeout(resolve, delayNeeded));
        }
        domainLastFetch.set(domain, Date.now());

        console.log(`[harvest] [${sIdx + 1}/${shuffledSources.length}] Fetching source: ${url}`);
        const res = await fetch(url, { 
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
          },
          signal: AbortSignal.timeout(6000)
        });

        if (!res.ok) {
          if (SOURCE_STATS[url]) SOURCE_STATS[url].failure++;
          throw new Error(`HTTP ${res.status}`);
        }

        const text = await res.text();
        const trimmed = text.trim();
        let parsedJson = false;
        const localProxies = [];

        const addParsedProxy = (ipStr, portVal) => {
          const proxyUrl = `socks5://${ipStr}:${portVal}`;
          if (!seenProxies.has(proxyUrl)) {
            seenProxies.add(proxyUrl);
            localProxies.push(proxyUrl);
          }
        };

        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try {
            const json = JSON.parse(trimmed);
            const dataArray = Array.isArray(json) ? json : (json.data || json.proxies || json.results || json.list || json.records || []);
            if (Array.isArray(dataArray)) {
              for (const item of dataArray) {
                if (item) {
                  const ip = item.ip || item.host || item.ipAddress || item.address;
                  const port = item.port || item.portNumber;
                  if (ip && port) {
                    const ipStr = ip.toString().trim();
                    const portVal = parseInt(port, 10);
                    const octets = ipStr.split('.').map(o => parseInt(o, 10));
                    if (octets.length === 4 && octets.every(o => o >= 0 && o <= 255) && portVal > 0 && portVal <= 65535) {
                      addParsedProxy(ipStr, portVal);
                    }
                  }
                }
              }
              parsedJson = true;
            }
          } catch (e) {
            // fallback to regex
          }
        }

        if (!parsedJson) {
          const regex = /\b((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})\b/g;
          let match;
          while ((match = regex.exec(text)) !== null) {
            const ip = match[1];
            const portVal = parseInt(match[2], 10);
            const octets = ip.split('.').map(o => parseInt(o, 10));
            if (octets.every(o => o >= 0 && o <= 255) && portVal > 0 && portVal <= 65535) {
              addParsedProxy(ip, portVal);
            }
          }
        }

        const totalParsed = localProxies.length;
        totalHarvested += totalParsed;
        const slicedProxies = localProxies.slice(0, 50);
        totalTested += slicedProxies.length;
        console.log(`[harvest] Parsed ${totalParsed} proxies. Testing first ${slicedProxies.length} candidates.`);

        if (slicedProxies.length > 0) {
          await concurrentMap(slicedProxies, 10, async (proxyUrl) => {
            try {
              const dispatcher = getProxyDispatcher(proxyUrl);
              if (!dispatcher) return;

              let proxyIp = null;
              let latency = 0;
              const startReq = Date.now();
              
              try {
                const resEcho = await undiciFetch("https://checkip.amazonaws.com", {
                  method: "GET",
                  dispatcher,
                  signal: AbortSignal.timeout(2500)
                });
                if (resEcho.ok) {
                  proxyIp = (await resEcho.text()).trim();
                  latency = Date.now() - startReq;
                }
              } catch (e) {
                // Skip fallback to keep validation extremely fast
              }

              if (proxyIp) {
                if (SERVER_PUBLIC_IP && proxyIp === SERVER_PUBLIC_IP) {
                  if (SOURCE_STATS[url]) SOURCE_STATS[url].failure++;
                  return;
                }

                totalPassedAnomality++;

                const existing = PROXY_MAP.get(proxyUrl);
                const proxyObj = {
                  url: proxyUrl,
                  latency,
                  source: url,
                  successCount: existing ? existing.successCount : 1,
                  failureCount: existing ? existing.failureCount : 0,
                  createdAt: existing ? (existing.createdAt || new Date().toISOString()) : new Date().toISOString()
                };

                insertIntoSortedPool(PROXY_POOL, proxyObj, 200);
                proxyStatus = `Refreshing (${PROXY_POOL.length} proxies active)`;
                
                if (SOURCE_STATS[url]) {
                  SOURCE_STATS[url].success++;
                  SOURCE_STATS[url].totalLatency += latency;
                }
              } else {
                if (SOURCE_STATS[url]) SOURCE_STATS[url].failure++;
              }
            } catch (err) {
              console.error(`[harvest] Exception inside validation handler for ${proxyUrl}:`, err.message, err.stack);
              if (SOURCE_STATS[url]) SOURCE_STATS[url].failure++;
            }
          });
        }
      } catch (err) {
        if (!err.message.includes("404")) {
          console.warn(`[harvest] Source failed ${url}: ${err.message}`);
        }
      }

      // Update database in real-time after each source
      if (logId) {
        try {
          stmts.updateProxyRefreshProgress.run(totalHarvested, totalTested, totalPassedAnomality, logId);
        } catch (dbErr) {
          // ignore
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    const durationMin = ((Date.now() - startTime) / (1000 * 60)); // running-time in minutes
    if (logId) {
      try {
        stmts.updateProxyRefreshDone.run(durationMin, totalHarvested, totalTested, totalPassedAnomality, logId);
      } catch (dbErr) {
        console.error("[aurora-provider] Failed to log refresh completion to DB:", dbErr.message);
      }
    }

    isRefreshingProxyPool = false;
    proxyStatus = `Active (${PROXY_POOL.length} proxies)`;
    console.log(`[aurora-provider] Refresh complete. Active pool size: ${PROXY_POOL.length} proxies. (Duration: ${durationMin.toFixed(2)} min, Harvested: ${totalHarvested}, Passed Anomality: ${totalPassedAnomality})`);
    
    if (PROXY_POOL.length > 0) {
      console.log("[aurora-provider] Top 10 fastest proxies in pool:");
      PROXY_POOL.slice(0, 10).forEach((p, idx) => {
        console.log(`  [Proxy ${idx + 1}] ${p.url} (${p.latency}ms) [Source: ${p.source.split('/').pop()}]`);
      });
    }
  }
}

function removeDeadProxy(proxyUrl) {
  const oldProxy = PROXY_MAP.get(proxyUrl);
  if (oldProxy) {
    const index = findIndexBinary(PROXY_POOL, proxyUrl, oldProxy.latency);
    if (index !== -1) {
      const proxyObj = PROXY_POOL[index];
      console.warn(`[aurora-provider] Removing dead proxy from pool: ${proxyUrl}`);
      if (proxyObj.source && SOURCE_STATS[proxyObj.source]) {
        SOURCE_STATS[proxyObj.source].failure++;
      }
      
      PROXY_POOL.splice(index, 1);
      if (proxyPoolIndex >= PROXY_POOL.length) {
        proxyPoolIndex = 0;
      }
      if (PROXY_POOL.length === 0) {
        proxyStatus = "No working proxies remaining. Using direct connection.";
      } else {
        proxyStatus = `Active (${PROXY_POOL.length} proxies)`;
      }
      saveActiveProxiesToDisk();
      
      const PROXIES_MAX_LIMIT = 200;
      if (PROXY_POOL.length < (PROXIES_MAX_LIMIT / 2) && !isRefreshingProxyPool) {
        console.log(`[aurora-provider] Proxy pool decreased by > 50% (${PROXY_POOL.length} remaining). Replenishing in background...`);
        refreshProxyPool("replenishing", true).catch(err => {
          console.error(`[aurora-provider] Auto-replenish failed: ${err.message}`);
        });
      }
    }
    PROXY_MAP.delete(proxyUrl);
    dispatcherCache.delete(proxyUrl);
  }
}

// ─── SSE Log Broadcaster ──────────────────────────────────────────────────────
const sseClients = new Set();
function broadcastLog(level, message) {
  if (sseClients.size === 0) return;
  const data = JSON.stringify({ timestamp: new Date().toISOString(), level, message });
  for (const streamInstance of sseClients) {
    try {
      streamInstance.writeSSE({
        data: data
      });
    } catch (e) {
      sseClients.delete(streamInstance);
    }
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
  return null;
}

// ─── Request builder ──────────────────────────────────────────────────────────

function buildBaseUrl(providerName, keyEntry) {
  const prov = PROVIDERS[providerName];
  let url = prov.baseUrl;

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
    let dispatcher;
    const proxyUrl = getNextProxy();
    const currentProxy = proxyUrl || "direct";
    if (proxyUrl) {
      console.log(`[aurora-provider] Routing request through proxy: ${proxyUrl} (attempt ${attempts + 1}/${maxProxyRetries + 1})`);
      dispatcher = getProxyDispatcher(proxyUrl);
    }

    try {
      const requestStart = Date.now();
      const res = await undiciFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        dispatcher,
      });

      if (res.status === 429) {
        if (proxyUrl && attempts < maxProxyRetries) {
          console.warn(`[aurora-provider] Proxy ${proxyUrl} rate-limited (HTTP 429). Evicting proxy and retrying key ${keyEntry.keyIndex} with another route...`);
          removeDeadProxy(proxyUrl);
          attempts++;
          continue;
        }

        if (proxyUrl) {
          console.warn(`[aurora-provider] Exceeded proxy retries for rate limits. Evicting final proxy ${proxyUrl}.`);
          removeDeadProxy(proxyUrl);
        }
        const failures = (keyState[makeKeyId(providerName, keyEntry.keyIndex)]?.failures ?? 0) + 1;
        const provCfg = PROVIDERS[providerName];
        const customCooldownSec = provCfg?.cooldownTime;
        const cooldown = customCooldownSec
          ? customCooldownSec * 1000
          : Math.min(60_000 * failures, 900_000);
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

      if (proxyUrl) {
        const pObj = PROXY_MAP.get(proxyUrl);
        if (pObj) {
          pObj.successCount++;
          if (pObj.source && SOURCE_STATS[pObj.source]) {
            SOURCE_STATS[pObj.source].success++;
            SOURCE_STATS[pObj.source].totalLatency += (Date.now() - requestStart);
          }
        }
      }

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

// ─── Aura-aware dispatch with fallback chain ─────────────────────────────────

async function dispatch(auraName, body) {
  const auraConfig = AURAS[auraName];
  if (!auraConfig) {
    return { error: `Unknown aura: ${auraName}` };
  }

  const chain = auraConfig.fallbacks;

  for (const step of chain) {
    const { provider, model } = step;

    const keys = KEYS_CFG[provider];
    if (!keys || keys.length === 0) {
      console.log(`[aurora-provider] Skipping ${provider} — no keys configured`);
      continue;
    }

    let providerExhausted = false;
    while (true) {
      const result = await attemptRequest(provider, model, body);

      if (result.success) {
        console.log(`[aurora-provider] ✓ ${auraName} → ${provider}/${model}`);
        return result;
      }

      if (result.error === "ALL_KEYS_EXHAUSTED") {
        providerExhausted = true;
        break;
      }

      if (result.error === "RATE_LIMITED") {
        const nextKey = getAvailableKey(provider);
        if (!nextKey) {
          providerExhausted = true;
          break;
        }
        continue;
      }

      break;
    }

    if (providerExhausted) {
      console.warn(`[aurora-provider] ✗ ${provider} exhausted — trying next fallback`);
    }
  }

  return { error: "ALL_FALLBACKS_EXHAUSTED", auraName };
}

// ─── Model-name → aura resolver ──────────────────────────────────────────────

function resolveAura(modelId) {
  if (!modelId) return null;
  const parts = modelId.split("/");
  const suffix = parts[parts.length - 1].toLowerCase();
  return AURAS[suffix] ? suffix : null;
}

// ─── Hono App & Middlewares ───────────────────────────────────────────────────

const app = new Hono();

// Global middlewares
app.use("*", cors());
app.use("*", compress());
app.use(
  "*",
  bodyLimit({
    maxSize: 2 * 1024 * 1024, // 2MB limit
    onError: (c) => {
      return c.json({ error: "Payload Too Large" }, 413);
    },
  })
);

// UI Static Routes via ultra-fast Bun.file()
app.get("/", async (c) => {
  try {
    const html = await Bun.file(join(ROOT, "src", "public", "index.html")).text();
    return c.html(html);
  } catch (e) {
    return c.text("UI Index Not Found", 404);
  }
});

app.get("/index.js", async (c) => {
  try {
    const js = await Bun.file(join(ROOT, "src", "public", "index.js")).text();
    return new Response(js, {
      headers: { "Content-Type": "application/javascript" },
    });
  } catch (e) {
    return c.text("Not Found", 404);
  }
});

app.get("/index.css", async (c) => {
  try {
    const css = await Bun.file(join(ROOT, "src", "public", "index.css")).text();
    return new Response(css, {
      headers: { "Content-Type": "text/css" },
    });
  } catch (e) {
    return c.text("Not Found", 404);
  }
});

// Config APIs
app.get("/api/config", (c) => {
  return c.json({
    providers: PROVIDERS,
    auras: AURAS,
    keys: KEYS_CFG
  });
});

app.post("/api/keys", async (c) => {
  try {
    const { keys } = await c.req.json();
    for (const key of Object.keys(KEYS_CFG)) {
      delete KEYS_CFG[key];
    }
    Object.assign(KEYS_CFG, keys);
    
    writeFileSync(join(VAULT_DIR, "keys.json"), JSON.stringify({
      _comment: "Aurora-Provider API keys store. Add multiple keys per provider — they will be rotated automatically on rate limit.",
      _security: "Keep this file out of version control. Add to .gitignore.",
      keys
    }, null, 2), "utf8");
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/auras", async (c) => {
  try {
    const { auras } = await c.req.json();
    AURAS = auras;
    writeFileSync(join(VAULT_DIR, "auras.json"), JSON.stringify({
      _comment: "Aurora-Provider aura definitions. Each aura has an ordered fallback chain: provider + model pairs sorted by context size → rate limit generosity → speed.",
      _version: "1.0.0",
      auras
    }, null, 2), "utf8");
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Providers API
app.get("/api/providers", (c) => {
  return c.json({ providers: PROVIDERS });
});

app.post("/api/providers", async (c) => {
  try {
    const { providers } = await c.req.json();
    for (const key of Object.keys(PROVIDERS)) {
      delete PROVIDERS[key];
    }
    Object.assign(PROVIDERS, providers);
    
    writeFileSync(join(VAULT_DIR, "providers.json"), JSON.stringify({
      _comment: "Aurora-Provider supported LLM providers catalog and models metadata.",
      providers
    }, null, 2), "utf8");
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/providers/:providerId/models", async (c) => {
  try {
    const providerId = c.req.param("providerId");
    const forceRefresh = c.req.query("refresh") === "true";
    const models = await getModelsForProvider(providerId, forceRefresh);
    return c.json({ models });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/providers/:providerId/models/settings", async (c) => {
  try {
    const providerId = c.req.param("providerId");
    const { modelId, markFree } = await c.req.json();
    
    if (!modelId) {
      return c.json({ error: "modelId is required" }, 400);
    }

    const settings = loadModelSettings();
    const markFreeKey = `${providerId}:${modelId}`;
    
    settings[markFreeKey] = { markFree: !!markFree };
    saveModelSettings(settings);

    if (MODELS_CACHE[providerId]) {
      const idx = MODELS_CACHE[providerId].findIndex(m => m.id === modelId);
      if (idx !== -1) {
        MODELS_CACHE[providerId][idx].markFree = !!markFree;
      }
    }

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Usage statistics and logs query API
app.get("/api/usage", (c) => {
  try {
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const aura = c.req.query("aura");
    const provider = c.req.query("provider");
    const source = c.req.query("source");
    const status = c.req.query("status");
    const host = c.req.query("host");
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = parseInt(c.req.query("limit") || "50", 10);

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
    if (aura) {
      clauses.push("aura = ?");
      params.push(aura);
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
    if (host) {
      clauses.push("request_host = ?");
      params.push(host);
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

    const totalTokens = db.prepare(`
      SELECT sum(total_tokens) as sum 
      FROM usage_logs 
      ${where}
    `).get(...params).sum || 0;

    // Paginated logs
    const offset = (page - 1) * limit;
    
    const logsSql = `
      SELECT * FROM usage_logs 
      ${where} 
      ORDER BY id DESC 
      LIMIT ? OFFSET ?
    `;
    const paginatedLogs = db.prepare(logsSql).all(...params, limit, offset);

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

    const uniqueHosts = stmts.selectDistinctHosts.all().map(r => r.request_host);

    return c.json({
      success: true,
      logs: paginatedLogs,
      totalCount,
      successCount,
      avgLatency: Math.round(avgLatency),
      totalTokens,
      uniqueHosts,
      stats: {
        providers: providersData,
        models: modelsData,
        sources: sourcesData,
        timeSeries: timeData
      }
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/usage/clear", (c) => {
  try {
    stmts.deleteUsageLogs.run();
    return c.json({ success: true, message: "Request logs history cleared." });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Logs stream (Server-Sent Events)
app.get("/api/logs-stream", (c) => {
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return streamSSE(c, async (streamInstance) => {
    sseClients.add(streamInstance);
    streamInstance.onAbort(() => {
      sseClients.delete(streamInstance);
    });
    while (true) {
      await streamInstance.sleep(10000);
    }
  });
});

// Settings API
app.get("/api/settings", (c) => {
  return c.json({ latencyThreshold: PROXY_LATENCY_THRESHOLD, enableProxy: ENABLE_PROXY });
});

app.post("/api/settings", async (c) => {
  try {
    const { latencyThreshold, enableProxy } = await c.req.json();
    let updated = {};

    if (latencyThreshold !== undefined) {
      if (typeof latencyThreshold === "number" && latencyThreshold >= 100) {
        PROXY_LATENCY_THRESHOLD = latencyThreshold;
        updated.latencyThreshold = PROXY_LATENCY_THRESHOLD;
      } else {
        return c.json({ error: "Invalid latencyThreshold" }, 400);
      }
    }

    let proxyToggledOn = false;
    if (enableProxy !== undefined) {
      if (typeof enableProxy === "boolean") {
        if (enableProxy && !ENABLE_PROXY) {
          proxyToggledOn = true;
        }
        ENABLE_PROXY = enableProxy;
        updated.enableProxy = ENABLE_PROXY;
      } else {
        return c.json({ error: "Invalid enableProxy value" }, 400);
      }
    }

    if (Object.keys(updated).length > 0) {
      const settingsPath = join(VAULT_DIR, "settings.json");
      let currentSettings = {};
      if (existsSync(settingsPath)) {
        try {
          currentSettings = JSON.parse(readFileSync(settingsPath, "utf8"));
        } catch (e) {
          // ignore
        }
      }
      const newSettings = { ...currentSettings, ...updated };
      writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), "utf8");

      if (ENABLE_PROXY && (updated.latencyThreshold !== undefined || proxyToggledOn)) {
        refreshProxyPool("user_triggered", true).catch(err => {
          console.error(`[aurora-provider] Error auto-refreshing proxy pool: ${err.message}`);
        });
      }

      return c.json({ success: true });
    } else {
      return c.json({ error: "No valid settings provided" }, 400);
    }
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// Proxies API
app.get("/api/proxies", (c) => {
  const sourceRankings = PROXY_SOURCES.map(src => {
    const stats = SOURCE_STATS[src] || { success: 0, failure: 0, totalLatency: 0 };
    const total = stats.success + stats.failure;
    const successRate = total > 0 ? (stats.success / total) * 100 : 0;
    const avgLatency = stats.success > 0 ? Math.round(stats.totalLatency / stats.success) : 0;
    return {
      source: src,
      success: stats.success,
      failure: stats.failure,
      successRate: Math.round(successRate),
      avgLatency: avgLatency
    };
  });

  const rankedByLatency = [...sourceRankings].sort((a, b) => {
    if (a.avgLatency === 0) return 1;
    if (b.avgLatency === 0) return -1;
    return a.avgLatency - b.avgLatency;
  });

  const rankedBySuccess = [...sourceRankings].sort((a, b) => {
    return b.successRate - a.successRate;
  });

  const totalMaskedRequests = stmts.countMaskedRequests.get().count;
  const successfulMaskedRequests = stmts.countSuccessMaskedRequests.get().count;
  const directRequests = stmts.countDirectRequests.get().count;

  return c.json({
    status: ENABLE_PROXY ? proxyStatus : "Disabled (IP Masking Off)",
    pool: PROXY_POOL,
    latencyThreshold: PROXY_LATENCY_THRESHOLD,
    rankedByLatency,
    rankedBySuccess,
    analytics: {
      totalMaskedRequests,
      successfulMaskedRequests,
      directRequests
    }
  });
});

app.post("/api/proxies/refresh", (c) => {
  if (!ENABLE_PROXY) {
    return c.json({ error: "Cannot refresh proxy pool when IP Masking (Proxy Pool) is disabled." }, 400);
  }
  refreshProxyPool("user_triggered", true).catch(err => {
    console.error(`[aurora-provider] Error refreshing proxy pool: ${err.message}`);
  });
  return c.json({ success: true, message: "Proxy refresh started in background." });
});

app.get("/api/proxies/refresh-history", (c) => {
  try {
    const logs = stmts.selectProxyRefreshHistory.all();
    return c.json({ success: true, logs });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/proxies/refresh-history/clear", (c) => {
  try {
    stmts.deleteProxyRefreshLogs.run();
    return c.json({ success: true, message: "Proxy refresh logs history cleared." });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", version: "1.0.0", auras: Object.keys(AURAS) });
});

// Key state dashboard
app.get("/status", (c) => {
  const summary = {};
  for (const [providerName, keys] of Object.entries(KEYS_CFG)) {
    if (!keys || keys.length === 0) continue;
    summary[providerName] = keys.map((_, i) => ({
      keyIndex: i,
      available: isKeyAvailable(providerName, i),
      state: keyState[makeKeyId(providerName, i)] ?? null,
    }));
  }
  return c.json({ keyStates: summary, uptime: process.uptime() });
});

// List models — returns all aura names as fake "models"
app.get("/v1/models", (c) => {
  const models = Object.keys(AURAS).map((name) => ({
    id: `aurora-provider/${name}`,
    object: "model",
    created: 1716000000,
    owned_by: "aurora-provider",
  }));
  return c.json({ object: "list", data: models });
});

function parseTextFromSse(sseData) {
  let text = "";
  let reasoning = "";
  let usage = null;
  const lines = sseData.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.usage) {
          usage = parsed.usage;
        }
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
  const cleanText = reasoning ? `[Reasoning]\n${reasoning}\n\n[Content]\n${text}` : text;
  return { text: cleanText, usage };
}

// Main completions endpoint
app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json();
  const { model, stream: isStream, ...rest } = body;
  
  const idleTime = Date.now() - lastRequestTime;
  lastRequestTime = Date.now();
  
  if (idleTime > 60 * 60 * 1000) { // > 1 hour
    console.log(`[aurora-provider] Server idle for ${Math.round(idleTime / 3600000)} hours. Force refreshing proxy pool...`);
    const beforePrune = PROXY_POOL.length;
    PROXY_POOL = PROXY_POOL.filter(p => p.latency <= PROXY_LATENCY_THRESHOLD);
    PROXY_MAP.clear();
    for (const p of PROXY_POOL) {
      PROXY_MAP.set(p.url, p);
    }
    console.log(`[aurora-provider] Synchronously pruned ${beforePrune - PROXY_POOL.length} slow proxies.`);
    saveActiveProxiesToDisk();
    refreshProxyPool("replenishing", false).catch(err => {
      console.error(`[aurora-provider] Forced proxy refresh failed: ${err.message}`);
    });
  }
  
  // Client Host capture
  const conn = getConnInfo(c);
  let clientIp = c.req.header("x-forwarded-for") || conn.remoteAddress || "127.0.0.1";
  if (clientIp.startsWith("::ffff:")) {
    clientIp = clientIp.substring(7);
  }
  clientIp = clientIp.split(",")[0].trim();

  let source = c.req.header("x-request-source");
  if (!source) {
    const origin = c.req.header("origin") || c.req.header("referer");
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
  const requestHost = source === "Testing" ? "Dashboard" : clientIp;

  const promptRaw = body.messages ? JSON.stringify(body.messages) : "";
  const prompt = promptRaw.length > 500 ? promptRaw.substring(0, 500) + "...[truncated]" : promptRaw;
  const promptText = body.messages ? body.messages.map(m => m.content || "").join(" ") : "";
  const estimatedPromptTokens = Math.max(1, Math.round(promptText.length / 4));

  const auraName = resolveAura(model);
  if (!auraName) {
    const errorMsg = `Unknown model/aura: "${model}". Available: ${Object.keys(AURAS).map((a) => `aurora-provider/${a}`).join(", ")}`;
    
    try {
      stmts.insertUsageLog.run(null, null, model, null, null, null, null, source, prompt, null, "Error", errorMsg, 0, estimatedPromptTokens, 0, estimatedPromptTokens, requestHost);
    } catch (err) {
      console.error("[aurora-provider] DB Error logging invalid model request:", err.message);
    }

    return c.json({
      error: {
        message: errorMsg,
        type: "invalid_request_error",
      },
    }, 400);
  }

  const start = Date.now();
  const payload = { ...rest, stream: isStream ?? false };
  const result = await dispatch(auraName, payload);

  if (result.error) {
    const latency = Date.now() - start;
    
    try {
      stmts.insertUsageLog.run(auraName, result.providerName || null, result.modelId || null, result.keyIndex !== undefined ? result.keyIndex : null, result.keyName || null, result.keyEmail || null, result.proxy || null, source, prompt, null, "Error", result.error, latency, estimatedPromptTokens, 0, estimatedPromptTokens, requestHost);
    } catch (err) {
      console.error("[aurora-provider] DB Error logging dispatch error:", err.message);
    }

    return c.json({
      error: {
        message: `Aurora-Provider: ${result.error} for aura "${auraName}"`,
        type: "service_unavailable",
      },
    }, 503);
  }

  const upstream = result.response;
  const ct = upstream.headers.get("content-type") || "text/plain";

  c.status(upstream.status);
  c.header("X-Aurora-Provider", `${result.providerName}/${result.modelId}`);

  if (isStream || ct.includes("text/event-stream")) {
    c.header("Content-Type", ct);
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    return stream(c, async (streamInstance) => {
      let fullResponseText = "";
      const decoder = new TextDecoder();
      
      for await (const chunk of upstream.body) {
        await streamInstance.write(chunk);
        fullResponseText += decoder.decode(chunk, { stream: true });
      }
      
      const latency = Date.now() - start;
      const { text: cleanResponse, usage: streamUsage } = parseTextFromSse(fullResponseText);
      
      const promptTokens = streamUsage?.prompt_tokens || estimatedPromptTokens;
      const completionTokens = streamUsage?.completion_tokens || Math.max(1, Math.round(cleanResponse.length / 4));
      const totalTokens = streamUsage?.total_tokens || (promptTokens + completionTokens);

      try {
        const responseForDb = cleanResponse.length > 500 ? cleanResponse.substring(0, 500) + "...[truncated]" : cleanResponse;
        stmts.insertUsageLog.run(auraName, result.providerName, result.modelId, result.keyIndex, result.keyName, result.keyEmail, result.proxy, source, prompt, responseForDb, "Success", null, latency, promptTokens, completionTokens, totalTokens, requestHost);
      } catch (err) {
        console.error("[aurora-provider] DB Error logging stream success:", err.message);
      }
    });
  } else {
    try {
      const data = await upstream.json();
      const latency = Date.now() - start;
      const responseText = data.choices?.[0]?.message?.content || "";

      const promptTokens = data.usage?.prompt_tokens || estimatedPromptTokens;
      const completionTokens = data.usage?.completion_tokens || Math.max(1, Math.round(responseText.length / 4));
      const totalTokens = data.usage?.total_tokens || (promptTokens + completionTokens);

      const responseForDb = responseText.length > 500 ? responseText.substring(0, 500) + "...[truncated]" : responseText;
      try {
        stmts.insertUsageLog.run(auraName, result.providerName, result.modelId, result.keyIndex, result.keyName, result.keyEmail, result.proxy, source, prompt, responseForDb, "Success", null, latency, promptTokens, completionTokens, totalTokens, requestHost);
      } catch (err) {
        console.error("[aurora-provider] DB Error logging JSON success:", err.message);
      }

      return c.json(data);
    } catch (err) {
      console.error("[aurora-provider] Error parsing JSON upstream or DB log:", err.message);
      return c.json({ error: "Failed to parse upstream JSON response" }, 500);
    }
  }
});

// ─── Background health probe (every 30 min) ───────────────────────────────────

async function probeAllKeys() {
  console.log("[aurora-provider] Running key health probe...");
  const testBody = {
    messages: [{ role: "user", content: "Reply with just the word OK." }],
    max_tokens: 5,
    stream: false,
  };

  for (const [providerName, provModels] of Object.entries(PROVIDERS)) {
    const keys = KEYS_CFG[providerName];
    if (!keys || keys.length === 0) continue;

    const models = await getModelsForProvider(providerName).catch(() => []);
    const firstModel = models?.[0]?.id;
    if (!firstModel) continue;

    for (let i = 0; i < keys.length; i++) {
      resetKey(providerName, i);
      const result = await attemptRequest(providerName, firstModel, testBody, i);
      if (result.success) {
        await result.response.text().catch(() => {});
        console.log(`[probe] ✓ ${providerName} key[${i}]`);
      } else {
        console.log(`[probe] ✗ ${providerName} key[${i}]: ${result.error}`);
      }
    }
  }
}

const PROBE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
setTimeout(() => {
  probeAllKeys();
  setInterval(probeAllKeys, PROBE_INTERVAL_MS);
}, 10_000);

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 8550;

Bun.serve({
  port: parseInt(PORT, 10),
  hostname: "127.0.0.1",
  fetch: app.fetch,
});

console.log(`
  Aurora-Provider (Hono on Bun Runtime)
  Local OpenAI-compatible LLM router
  Listening: http://127.0.0.1:${PORT}
  Auras:     ${Object.keys(AURAS).join(", ")}
`);

await detectServerPublicIp();
refreshProxyPool("onstart_server", true).catch(err => {
  console.error(`[aurora-provider] Error on initial proxy load: ${err.message}`);
});
