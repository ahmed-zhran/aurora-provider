import { fetch as undiciFetch } from "undici";
import { socksDispatcher } from "fetch-socks";

async function run() {
  const listRes = await undiciFetch("https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt");
  const text = await listRes.text();
  const proxies = text.split('\n').map(l => l.trim()).filter(l => l);
  console.log("Found", proxies.length, "proxies to test.");
  
  let passed2500 = 0;
  let passed8000 = 0;
  
  const testProxy = async (proxyStr, timeout) => {
    const [host, port] = proxyStr.split(':');
    const dispatcher = socksDispatcher({ type: 5, host, port: parseInt(port) }, { connect: { timeout } });
    try {
      const res = await undiciFetch("http://checkip.amazonaws.com", {
        method: "GET",
        dispatcher,
        signal: AbortSignal.timeout(timeout)
      });
      if (res.ok) return true;
    } catch(e) {}
    return false;
  };

  const sample = proxies.slice(0, 50);
  await Promise.all(sample.map(async p => {
    if (await testProxy(p, 2500)) passed2500++;
  }));
  await Promise.all(sample.map(async p => {
    if (await testProxy(p, 10000)) passed8000++;
  }));
  
  console.log(`Passed with 2500ms: ${passed2500}`);
  console.log(`Passed with 10000ms: ${passed8000}`);
}
run();
