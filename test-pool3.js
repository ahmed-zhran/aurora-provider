import { fetch as undiciFetch } from "undici";
import { socksDispatcher } from "fetch-socks";

async function run() {
  const listRes = await undiciFetch("https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt");
  const text = await listRes.text();
  const proxies = text.split('\n').map(l => l.trim()).filter(l => l);
  console.log("Found", proxies.length, "proxies to test.");
  
  let passedHTTPS = 0;
  
  const testProxy = async (proxyStr, timeout) => {
    const [host, port] = proxyStr.split(':');
    const dispatcher = socksDispatcher({ type: 5, host, port: parseInt(port) }, { connect: { timeout } });
    try {
      const res = await undiciFetch("https://checkip.amazonaws.com", {
        method: "GET",
        dispatcher,
        signal: AbortSignal.timeout(timeout)
      });
      if (res.ok) {
        const ip = await res.text();
        return ip.trim();
      }
    } catch(e) {}
    return null;
  };

  const sample = proxies.slice(0, 50);
  await Promise.all(sample.map(async p => {
    const ip = await testProxy(p, 5000);
    if (ip) {
      passedHTTPS++;
      // console.log(p, "gave IP:", ip);
    }
  }));
  
  console.log(`Passed HTTPS: ${passedHTTPS}`);
}
run();
