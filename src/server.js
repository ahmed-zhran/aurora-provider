import express from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fetch as undiciFetch } from "undici";
import { socksDispatcher } from "fetch-socks";
import dns from "dns";
import Database from "better-sqlite3";

dns.setDefaultResultOrder("ipv4first");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const VAULT_DIR = join(ROOT, "vault");
if (!existsSync(VAULT_DIR)) {
  mkdirSync(VAULT_DIR, { recursive: true });
}

// Migrate configuration files to vault on boot
const configFiles = ["providers.json", "agents.json", "keys.json"];
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
      writeFileSync(dest, JSON.stringify(defaultVal, null, 2), "utf8");
    }
  }
}

// ─── Database loading ─────────────────────────────────────────────────────────
const db = new Database(join(VAULT_DIR, "vault.db"));
db.run = function (sql) {
  return this.exec(sql);
};
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
    latency_ms INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    request_host TEXT
  )
`);

// Safe column migrations for existing databases
try {
  const columns = db.prepare("PRAGMA table_info(usage_logs)").all();
  const columnNames = columns.map(c => c.name);

  const migrations = [
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
} catch (err) {
  console.error("[aurora-provider] Error running database migrations:", err.message);
}

// ─── Config loading ───────────────────────────────────────────────────────────

function loadJSON(file) {
  return JSON.parse(readFileSync(join(VAULT_DIR, file), "utf8"));
}

const PROVIDERS = loadJSON("providers.json").providers;
let AGENTS      = loadJSON("agents.json").agents;
let KEYS_CFG    = loadJSON("keys.json").keys;

// ─── Proxy pool & testing ─────────────────────────────────────────────────────
let PROXY_POOL = []; // Array of { url, latency, source, successCount, failureCount }
let proxyPoolIndex = 0;
let proxyStatus = "Idle"; // "Scraping...", "Testing...", "Active"

let SERVER_PUBLIC_IP = "";

function getProxyDispatcher(proxyUrl) {
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
    return socksDispatcher(options, {
      connect: {
        timeout: 2500
      }
    });
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
try {
  const settingsPath = join(VAULT_DIR, "settings.json");
  if (existsSync(settingsPath)) {
    const s = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (s.latencyThreshold !== undefined) {
      PROXY_LATENCY_THRESHOLD = Math.max(100, Number(s.latencyThreshold));
    }
  }
} catch (e) {
  console.warn("[aurora-provider] Failed to load settings.json:", e.message);
}

const TARGET_COUNTRIES = ["EG", "TR", "GR", "CY", "IT", "NL", "DE", "FR", "GB", "ES", "SA", "AE", "US", "SG", "MX"];

const COUNTRY_NAME_MAP = {
  EG: "egypt",
  TR: "turkey",
  GR: "greece",
  CY: "cyprus",
  IT: "italy",
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
  ...["Falkenstein", "Frankfurt", "Amsterdam", "Paris", "London", "Milan", "Istanbul", "Cairo"].flatMap(city =>
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
  ...["france", "germany", "netherlands", "turkey", "united-states", "greece", "egypt"].map(c => `https://litport.net/free-proxy/${c}`),

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
  if (!PROXY_POOL || PROXY_POOL.length === 0) return null;
  const activeLimit = Math.min(PROXY_POOL.length, 10);
  const proxy = PROXY_POOL[proxyPoolIndex % activeLimit];
  proxyPoolIndex = (proxyPoolIndex + 1) % activeLimit;
  return proxy.url;
}

// Scrape and test proxies
let lastAutoRefreshTime = 0;

function insertIntoSortedPool(pool, proxyObj, maxLimit = 200) {
  const existingIdx = pool.findIndex(p => p.url === proxyObj.url);
  if (existingIdx !== -1) {
    if (proxyObj.latency < pool[existingIdx].latency) {
      pool.splice(existingIdx, 1);
    } else {
      return;
    }
  }

  const insertIdx = pool.findIndex(p => p.latency > proxyObj.latency);
  if (insertIdx === -1) {
    if (pool.length < maxLimit) {
      pool.push(proxyObj);
    }
  } else {
    pool.splice(insertIdx, 0, proxyObj);
  }

  if (pool.length > maxLimit) {
    pool.pop();
  }
}

// Scrape and test proxies sequentially source-by-source
async function refreshProxyPool(isManual = false) {
  if (proxyStatus.startsWith("Scraping") || proxyStatus.startsWith("Testing") || proxyStatus.startsWith("Refreshing")) {
    console.log("[aurora-provider] Proxy refresh already in progress. Skipping.");
    return;
  }

  if (!isManual) {
    const timeSinceLast = Date.now() - lastAutoRefreshTime;
    if (timeSinceLast < 60 * 60 * 1000) { // 1 hour minimum
      console.log(`[aurora-provider] Auto-refresh skipped. Only ${Math.round(timeSinceLast / 60000)} minutes since last refresh (minimum 1 hour).`);
      return;
    }
    lastAutoRefreshTime = Date.now();
  }

  proxyStatus = "Refreshing proxy pool...";
  console.log(`[aurora-provider] ${proxyStatus} (Sequential harvesting + testing)`);

  const newPool = [];
  const seenProxies = new Set();

  for (let sIdx = 0; sIdx < PROXY_SOURCES.length; sIdx++) {
    const url = PROXY_SOURCES[sIdx];
    const sourceCleanName = url.split('/').pop() || url;
    console.log(`[harvest] [${sIdx + 1}/${PROXY_SOURCES.length}] Fetching source: ${url}`);
    
    try {
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
      const slicedProxies = localProxies.slice(0, 50);
      console.log(`[harvest] Parsed ${totalParsed} proxies. Testing first ${slicedProxies.length} candidates.`);

      if (slicedProxies.length > 0) {
        const concurrencyLimit = 25;
        for (let i = 0; i < slicedProxies.length; i += concurrencyLimit) {
          const chunk = slicedProxies.slice(i, i + concurrencyLimit);
          await Promise.all(chunk.map(async (proxyUrl) => {
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

                const existing = PROXY_POOL.find(p => p.url === proxyUrl);
                const proxyObj = {
                  url: proxyUrl,
                  latency,
                  source: url,
                  successCount: existing ? existing.successCount : 1,
                  failureCount: existing ? existing.failureCount : 0
                };

                insertIntoSortedPool(newPool, proxyObj, 200);
                PROXY_POOL = [...newPool];
                proxyStatus = `Active (${PROXY_POOL.length} proxies)`;
                
                if (SOURCE_STATS[url]) {
                  SOURCE_STATS[url].success++;
                  SOURCE_STATS[url].totalLatency += latency;
                }
              } else {
                if (SOURCE_STATS[url]) SOURCE_STATS[url].failure++;
              }
            } catch (err) {
              if (SOURCE_STATS[url]) SOURCE_STATS[url].failure++;
            }
          }));
        }
      }
    } catch (err) {
      if (!err.message.includes("404")) {
        console.warn(`[harvest] Source failed ${url}: ${err.message}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  proxyStatus = `Active (${PROXY_POOL.length} proxies)`;
  console.log(`[aurora-provider] Refresh complete. Active pool size: ${PROXY_POOL.length} proxies.`);
  
  if (PROXY_POOL.length > 0) {
    console.log("[aurora-provider] Top 10 fastest proxies in pool:");
    PROXY_POOL.slice(0, 10).forEach((p, idx) => {
      console.log(`  [Proxy ${idx + 1}] ${p.url} (${p.latency}ms) [Source: ${p.source.split('/').pop()}]`);
    });
  }
}

function removeDeadProxy(proxyUrl) {
  const index = PROXY_POOL.findIndex(p => p.url === proxyUrl);
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
    
    const PROXIES_MAX_LIMIT = 100;
    if (PROXY_POOL.length < (PROXIES_MAX_LIMIT / 2) && !proxyStatus.startsWith("Scraping") && !proxyStatus.startsWith("Testing")) {
      console.log(`[aurora-provider] Proxy pool decreased by > 50% (${PROXY_POOL.length} remaining). Replenishing in background...`);
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

      if (proxyUrl) {
        const pObj = PROXY_POOL.find(p => p.url === proxyUrl);
        if (pObj) {
          pObj.successCount++;
          if (pObj.source && SOURCE_STATS[pObj.source]) {
            SOURCE_STATS[pObj.source].success++;
            SOURCE_STATS[pObj.source].totalLatency += (Date.now() - requestStart);
          }
        }
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
    keys: KEYS_CFG
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
    const { startDate, endDate, agent, provider, source, status, host, page = 1, limit = 50 } = req.query;

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

    // Get all distinct request hosts for filter populating
    const uniqueHosts = db.prepare(`
      SELECT DISTINCT request_host 
      FROM usage_logs 
      WHERE request_host IS NOT NULL AND request_host != ''
    `).all().map(r => r.request_host);

    res.json({
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

// Settings API
app.get("/api/settings", (req, res) => {
  res.json({ latencyThreshold: PROXY_LATENCY_THRESHOLD });
});

app.post("/api/settings", (req, res) => {
  try {
    const { latencyThreshold } = req.body;
    if (typeof latencyThreshold === "number" && latencyThreshold >= 100) {
      PROXY_LATENCY_THRESHOLD = latencyThreshold;
      writeFileSync(join(VAULT_DIR, "settings.json"), JSON.stringify({ latencyThreshold }, null, 2), "utf8");
      
      // Auto-trigger a proxy pool refresh to re-evaluate under the new threshold!
      refreshProxyPool(true).catch(err => {
        console.error(`[aurora-provider] Error auto-refreshing proxy pool on threshold change: ${err.message}`);
      });
      
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Invalid latencyThreshold" });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Proxies API
app.get("/api/proxies", (req, res) => {
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

  res.json({
    status: proxyStatus,
    pool: PROXY_POOL,
    latencyThreshold: PROXY_LATENCY_THRESHOLD,
    rankedByLatency,
    rankedBySuccess
  });
});

app.post("/api/proxies/refresh", (req, res) => {
  refreshProxyPool(true).catch(err => {
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
app.post("/v1/chat/completions", async (req, res) => {
  const { model, stream, ...rest } = req.body;
  
  // Inactivity check
  const idleTime = Date.now() - lastRequestTime;
  lastRequestTime = Date.now();
  
  if (idleTime > 60 * 60 * 1000) { // > 1 hour
    console.log(`[aurora-provider] Server idle for ${Math.round(idleTime / 3600000)} hours. Force refreshing proxy pool...`);
    const beforePrune = PROXY_POOL.length;
    PROXY_POOL = PROXY_POOL.filter(p => p.latency <= PROXY_LATENCY_THRESHOLD);
    console.log(`[aurora-provider] Synchronously pruned ${beforePrune - PROXY_POOL.length} slow proxies.`);
    refreshProxyPool().catch(err => {
      console.error(`[aurora-provider] Forced proxy refresh failed: ${err.message}`);
    });
  }
  
  // Client Host capture
  let clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  if (clientIp.startsWith("::ffff:")) {
    clientIp = clientIp.substring(7);
  }
  clientIp = clientIp.split(",")[0].trim();

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
  const requestHost = source === "Testing" ? "Dashboard" : clientIp;

  const prompt = req.body.messages ? JSON.stringify(req.body.messages) : "";
  const promptText = req.body.messages ? req.body.messages.map(m => m.content || "").join(" ") : "";
  const estimatedPromptTokens = Math.max(1, Math.round(promptText.length / 4));

  const agentName = resolveAgent(model);
  if (!agentName) {
    const errorMsg = `Unknown model/agent: "${model}". Available: ${Object.keys(AGENTS).map((a) => `aurora-provider/${a}`).join(", ")}`;
    
    // Log invalid request error to SQLite
    try {
      const stmt = db.prepare(`
        INSERT INTO usage_logs (
          agent, provider, model, key_index, key_name, key_email, proxy, source, prompt, response, status, error_message, latency_ms,
          prompt_tokens, completion_tokens, total_tokens, request_host
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(null, null, model, null, null, null, null, source, prompt, null, "Error", errorMsg, 0, estimatedPromptTokens, 0, estimatedPromptTokens, requestHost);
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
          agent, provider, model, key_index, key_name, key_email, proxy, source, prompt, response, status, error_message, latency_ms,
          prompt_tokens, completion_tokens, total_tokens, request_host
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(agentName, result.providerName || null, result.modelId || null, result.keyIndex !== undefined ? result.keyIndex : null, result.keyName || null, result.keyEmail || null, result.proxy || null, source, prompt, null, "Error", result.error, latency, estimatedPromptTokens, 0, estimatedPromptTokens, requestHost);
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
    const { text: cleanResponse, usage: streamUsage } = parseTextFromSse(fullResponseText);
    
    const promptTokens = streamUsage?.prompt_tokens || estimatedPromptTokens;
    const completionTokens = streamUsage?.completion_tokens || Math.max(1, Math.round(cleanResponse.length / 4));
    const totalTokens = streamUsage?.total_tokens || (promptTokens + completionTokens);

    // Log successful stream request to SQLite
    try {
      const stmt = db.prepare(`
        INSERT INTO usage_logs (
          agent, provider, model, key_index, key_name, key_email, proxy, source, prompt, response, status, error_message, latency_ms,
          prompt_tokens, completion_tokens, total_tokens, request_host
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(agentName, result.providerName, result.modelId, result.keyIndex, result.keyName, result.keyEmail, result.proxy, source, prompt, cleanResponse, "Success", null, latency, promptTokens, completionTokens, totalTokens, requestHost);
    } catch (err) {
      console.error("[aurora-provider] DB Error logging stream success:", err.message);
    }
  } else {
    try {
      const data = await upstream.json();
      res.json(data);

      const latency = Date.now() - start;
      const responseText = data.choices?.[0]?.message?.content || "";

      const promptTokens = data.usage?.prompt_tokens || estimatedPromptTokens;
      const completionTokens = data.usage?.completion_tokens || Math.max(1, Math.round(responseText.length / 4));
      const totalTokens = data.usage?.total_tokens || (promptTokens + completionTokens);

      // Log successful JSON request to SQLite
      const stmt = db.prepare(`
        INSERT INTO usage_logs (
          agent, provider, model, key_index, key_name, key_email, proxy, source, prompt, response, status, error_message, latency_ms,
          prompt_tokens, completion_tokens, total_tokens, request_host
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(agentName, result.providerName, result.modelId, result.keyIndex, result.keyName, result.keyEmail, result.proxy, source, prompt, responseText, "Success", null, latency, promptTokens, completionTokens, totalTokens, requestHost);
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
app.listen(PORT, "127.0.0.1", async () => {
  console.log(`
╔══════════════════════════════════════════╗
║       Aurora-Provider  v1.0.0            ║
║  Local OpenAI-compatible LLM router      ║
╠══════════════════════════════════════════╣
║  Listening: http://127.0.0.1:${PORT}        ║
║  Agents:    ${Object.keys(AGENTS).join(", ").padEnd(30)}║
╚══════════════════════════════════════════╝
  `);
  await detectServerPublicIp();
  refreshProxyPool(true).catch(err => {
    console.error(`[aurora-provider] Error on initial proxy load: ${err.message}`);
  });
});

// Trigger watcher reload to load new agents.json configurations (refreshed keys - hot reload triggered)

