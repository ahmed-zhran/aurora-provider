import nodeFetch from "node-fetch";
import { SocksProxyAgent } from "socks-proxy-agent";

async function run() {
  const agent = new SocksProxyAgent("socks5://103.20.235.148:1080", { timeout: 10000 });
  try {
    const res = await nodeFetch("https://checkip.amazonaws.com", {
      agent,
      timeout: 10000 // node-fetch supports timeout directly
    });
    console.log("HTTPS status:", res.status);
    console.log("HTTPS IP:", await res.text());
  } catch(e) {
    console.error("HTTPS Error:", e.message);
  }
}
run();
