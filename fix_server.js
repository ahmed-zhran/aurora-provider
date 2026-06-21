import fs from 'fs';

let code = fs.readFileSync('src/server.js', 'utf8');

const targetStart = "async function refreshProxyPool(triggerCause = \"replenishing\", bypassCooldown = true) {";
const targetEnd = "// ─── OpenAI Compatible Endpoints ──────────────────────────────────────────────";

const idx1 = code.indexOf(targetStart);
const idx2 = code.indexOf(targetEnd);

if(idx1 === -1 || idx2 === -1) {
  console.log("NOT FOUND");
  process.exit(1);
}

const replacement = `async function refreshProxyPool(triggerCause = "replenishing", bypassCooldown = true) {
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

  console.log(\`[aurora-provider] Refreshing proxy pool... (Aggregated testing) [Cause: \${triggerCause}]\`);

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

        console.log(\`[harvest] [\${sIdx + 1}/\${shuffledSources.length}] Fetching source: \${url}\`);
        const res = await fetch(url, { 
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
          },
          signal: AbortSignal.timeout(10000)
        });

        if (!res.ok) {
          if (SOURCE_STATS[url]) SOURCE_STATS[url].failure++;
          throw new Error(\`HTTP \${res.status}\`);
        }

        const text = await res.text();
        const trimmed = text.trim();
        let parsedJson = false;
        const localProxies = [];

        const addParsedProxy = (ipStr, portVal) => {
          const scheme = url.toLowerCase().includes('socks') ? 'socks5' : 'http';
          const proxyUrl = \`\${scheme}://\${ipStr}:\${portVal}\`;
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
        console.log(\`[harvest] Parsed \${totalParsed} proxies from \${url}.\`);

      } catch (e) {
        console.error(\`[harvest] Source failed \${url}:\`, e.message);
        if (SOURCE_STATS[url]) SOURCE_STATS[url].failure++;
      }
    }

    const allProxies = Array.from(seenProxies);
    allProxies.sort(() => Math.random() - 0.5);
    const testPool = allProxies.slice(0, 3000); // Take max 3000 proxies randomly
    totalTested = testPool.length;
    
    console.log(\`[harvest] Harvested \${totalHarvested} total proxies. Testing a random pool of \${testPool.length} proxies... (High Concurrency)\`);

    if (testPool.length > 0) {
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
              source: "aggregated",
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
    const durationMin = ((Date.now() - startTime) / 60000).toFixed(2);
    
    // Sort pool by latency and take top 100
    PROXY_POOL.sort((a, b) => a.latency - b.latency);
    if (PROXY_POOL.length > 100) {
      const removed = PROXY_POOL.splice(100);
      removed.forEach(r => PROXY_MAP.delete(r.url));
    }
    
    saveActiveProxiesToDisk();
    
    console.log(\`[aurora-provider] Refresh complete. Active pool size: \${PROXY_POOL.length} proxies. (Duration: \${durationMin} min, Harvested: \${totalHarvested}, Passed Anomality: \${totalPassedAnomality})\`);

    if (logId) {
      try {
        stmts.updateProxyRefreshDone.run(
          "done",
          totalHarvested,
          totalPassedAnomality,
          totalTested,
          logId
        );
      } catch (dbErr) {
        console.error("[aurora-provider] Failed to update proxy refresh log:", dbErr.message);
      }
    }
  }
}

`;

const newCode = code.substring(0, idx1) + replacement + "\n" + code.substring(idx2);
fs.writeFileSync('src/server.js', newCode);
console.log("SUCCESS");
