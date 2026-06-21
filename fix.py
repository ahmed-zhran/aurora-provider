import re

with open('src/server.js', 'r') as f:
    code = f.read()

# 1. Add smartFetch imports and helper if not there
if "import { HttpsProxyAgent } from \"https-proxy-agent\";" not in code:
    code = code.replace('import { fetch as undiciFetch } from "undici";\nimport { socksDispatcher } from "fetch-socks";', 
'''import { fetch as undiciFetch } from "undici";
import nodeFetch from "node-fetch";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

async function smartFetch(url, options = {}) {
  if (options.dispatcher && (options.dispatcher instanceof SocksProxyAgent || options.dispatcher instanceof HttpsProxyAgent)) {
    const nodeFetchOpts = { ...options };
    nodeFetchOpts.agent = options.dispatcher;
    delete nodeFetchOpts.dispatcher;
    return await nodeFetch(url, nodeFetchOpts);
  }
  return await undiciFetch(url, options);
}''')

# 2. Fix getProxyDispatcher
dispatcher_old = '''function getProxyDispatcher(proxyUrl) {
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
}'''

dispatcher_new = '''function getProxyDispatcher(proxyUrl) {
  const cached = dispatcherCache.get(proxyUrl);
  if (cached) return cached;
  try {
    let agent;
    if (proxyUrl.startsWith("socks")) {
      agent = new SocksProxyAgent(proxyUrl, { timeout: 10000 });
    } else {
      agent = new HttpsProxyAgent(proxyUrl, { timeout: 10000 });
    }
    dispatcherCache.set(proxyUrl, agent);
    // Evict oldest if cache grows too large
    if (dispatcherCache.size > 250) {
      const firstKey = dispatcherCache.keys().next().value;
      dispatcherCache.delete(firstKey);
    }
    return agent;
  } catch (e) {
    console.error(`[aurora-provider] Failed to parse proxy URL: ${proxyUrl}`, e.message);
    return null;
  }
}'''

code = code.replace(dispatcher_old, dispatcher_new)

# 3. Replace PROXY_SOURCES
sources_pattern = re.compile(r'const PROXY_SOURCES = \[.*?\];\n', re.DOTALL)
sources_new = '''const PROXY_SOURCES = [
  // HTTP / HTTPS APIs (Better for HTTPS tunneling)
  ...Array.from({ length: 5 }, (_, i) => `https://proxylist.geonode.com/api/proxy-list?protocols=http%2Chttps&limit=100&page=${i + 1}&sort_by=lastChecked&sort_type=desc`),
  ...Array.from({ length: 5 }, (_, i) => `https://proxylist.geonode.com/api/proxy-list?protocols=http%2Chttps&limit=100&page=${i + 1}&sort_by=lastChecked&sort_type=desc&anonymityLevel=elite`),
  ...Array.from({ length: 5 }, (_, i) => `https://proxylist.geonode.com/api/proxy-list?protocols=http%2Chttps&limit=100&page=${i + 1}&sort_by=lastChecked&sort_type=desc&anonymityLevel=anonymous`),
  "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=elite",
  "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=anonymous",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/rdavydov/proxy-list/main/proxies/http.txt",

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

  // 1. Geonode SOCKS5 Free API - Pagination + Anonymity levels (first 5 pages + country filtered pages)
  ...Array.from({ length: 5 }, (_, i) => `https://proxylist.geonode.com/api/proxy-list?protocols=socks5&limit=100&page=${i + 1}&sort_by=lastChecked&sort_type=desc`),
  ...Array.from({ length: 5 }, (_, i) => `https://proxylist.geonode.com/api/proxy-list?protocols=socks5&limit=100&page=${i + 1}&sort_by=lastChecked&sort_type=desc&anonymityLevel=elite`),
  ...Array.from({ length: 5 }, (_, i) => `https://proxylist.geonode.com/api/proxy-list?protocols=socks5&limit=100&page=${i + 1}&sort_by=lastChecked&sort_type=desc&anonymityLevel=anonymous`),

  // Country-specific pages (2 pages of general + 1 page of elite + 1 page of anonymous per near/fast country)
  ...TARGET_COUNTRIES.flatMap(country => [
    `https://proxylist.geonode.com/api/proxy-list?protocols=socks5&limit=100&page=1&sort_by=lastChecked&sort_type=desc&country=${country}`,
    `https://proxylist.geonode.com/api/proxy-list?limit=100&page=2&sort_by=lastChecked&sort_type=desc&country=${country}`,
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
  ...TARGET_COUNTRIES.map(c => `https://databay.com/api/v1/proxy-list?format=json&limit=100&country=${c}`)
];
'''
code = sources_pattern.sub(sources_new, code)

# 4. Replace refreshProxyPool
idx_start = code.find('async function refreshProxyPool')
idx_end = code.find('function removeDeadProxy')

refresh_new = '''async function refreshProxyPool(triggerCause = "replenishing", bypassCooldown = true) {
  if (!ENABLE_PROXY) {
    console.log("[aurora-provider] Proxy usage is disabled. Skipping proxy pool refresh.");
    return;
  }
  if (isRefreshingProxyPool) {
    console.log("[aurora-provider] Proxy refresh already in progress. Skipping.");
    return;
  }
  const now = Date.now();
  if (!bypassCooldown && now - lastProxyRefreshTime < 1000 * 60 * 5) {
    console.log("[aurora-provider] Skipping proxy refresh due to 5-minute cooldown.");
    return;
  }
  isRefreshingProxyPool = true;
  lastProxyRefreshTime = now;

  console.log(`[aurora-provider] Refreshing proxy pool... (Aggregated testing) [Cause: ${triggerCause}]`);

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
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
          },
          signal: AbortSignal.timeout(8000)
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
          const scheme = url.toLowerCase().includes('socks') ? 'socks5' : 'http';
          const proxyUrl = `${scheme}://${ipStr}:${portVal}`;
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
          const regex = /\\b((?:\\d{1,3}\\.){3}\\d{1,3}):(\\d{1,5})\\b/g;
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
        console.log(`[harvest] Parsed ${totalParsed} proxies from this source.`);
        
        if (totalParsed > 0 && SOURCE_STATS[url]) {
          SOURCE_STATS[url].success++;
        }

      } catch (e) {
        console.error(`[harvest] Source failed ${url}:`, e.message);
        if (SOURCE_STATS[url]) SOURCE_STATS[url].failure++;
      }
    }

    const allProxies = Array.from(seenProxies);
    allProxies.sort(() => Math.random() - 0.5); // shuffle
    const testPool = allProxies.slice(0, 3000); // take first 3000
    totalTested = testPool.length;
    
    console.log(`[harvest] Total unique harvested proxies: ${allProxies.length}. Testing random pool of ${testPool.length} proxies concurrently...`);

    if (testPool.length > 0) {
      // Test at high concurrency (100) since we are no longer iterating per-source for tests
      await concurrentMap(testPool, 100, async (proxyUrl) => {
        try {
          const dispatcher = getProxyDispatcher(proxyUrl);
          if (!dispatcher) return;

          let proxyIp = null;
          let latency = 0;
          const startReq = Date.now();
          
          try {
            const resEcho = await smartFetch("https://checkip.amazonaws.com", {
              method: "GET",
              dispatcher,
              signal: AbortSignal.timeout(8000)
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
              return;
            }

            totalPassedAnomality++;

            const existing = PROXY_MAP.get(proxyUrl);
            const proxyObj = {
              url: proxyUrl,
              latency,
              source: "aggregated-pool",
              successCount: existing ? existing.successCount : 1,
              failureCount: existing ? existing.failureCount : 0,
              createdAt: existing ? (existing.createdAt || new Date().toISOString()) : new Date().toISOString()
            };

            insertIntoSortedPool(PROXY_POOL, proxyObj, 200);
          }
        } catch (e) {
          // Ignore dispatcher creation errors
        }
      });
    }

  } catch (err) {
    console.error("[aurora-provider] Proxy refresh failed:", err.message);
    if (logId) {
      try {
        stmts.updateProxyRefreshProgress.run("failed", 0, 0, 0, logId);
      } catch (dbErr) { }
    }
  } finally {
    isRefreshingProxyPool = false;
    const durationMin = ((Date.now() - startTime) / 60000);
    
    // Sort pool by latency and take top 100
    PROXY_POOL.sort((a, b) => a.latency - b.latency);
    if (PROXY_POOL.length > 100) {
      const removed = PROXY_POOL.splice(100);
      removed.forEach(r => PROXY_MAP.delete(r.url));
    }
    
    saveActiveProxiesToDisk();
    
    console.log(`[aurora-provider] Refresh complete. Active pool size: ${PROXY_POOL.length} proxies. (Duration: ${durationMin.toFixed(2)} min, Harvested: ${totalHarvested}, Passed Anomality: ${totalPassedAnomality})`);

    if (logId) {
      try {
        stmts.updateProxyRefreshDone.run(
          durationMin,
          totalHarvested,
          totalTested,
          totalPassedAnomality,
          logId
        );
      } catch (dbErr) {
        console.error("[aurora-provider] Failed to update proxy refresh log:", dbErr.message);
      }
    }
  }
}

'''

code = code[:idx_start] + refresh_new + code[idx_end:]

# 5. Fix attemptRequest and probeKeyHealth `undiciFetch` to `smartFetch`
code = code.replace("await undiciFetch(`${baseUrl}/chat/completions`", "await smartFetch(`${baseUrl}/chat/completions`")
code = code.replace("await undiciFetch(`${baseUrl}/models`", "await smartFetch(`${baseUrl}/models`")

with open('src/server.js', 'w') as f:
    f.write(code)

print("done")
