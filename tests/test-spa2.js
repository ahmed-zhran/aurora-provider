import { SocksProxyAgent } from "socks-proxy-agent";

async function run() {
  const agent = new SocksProxyAgent("socks5://103.20.235.148:1080");
  try {
    const res = await fetch("https://checkip.amazonaws.com", {
      method: "GET",
      dispatcher: agent,
      signal: AbortSignal.timeout(10000)
    });
    console.log("HTTPS status:", res.status);
    console.log("HTTPS IP:", await res.text());
  } catch(e) {
    console.error("HTTPS Error:", e.cause);
  }
}
run();
