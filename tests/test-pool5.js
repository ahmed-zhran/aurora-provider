import { fetch as undiciFetch } from "undici";
import { socksDispatcher } from "fetch-socks";

async function run() {
  const options = { type: 5, host: "103.20.235.148", port: 1080 }; 
  const dispatcher = socksDispatcher(options, { connect: { timeout: 10000 } });
  try {
    const res = await undiciFetch("https://checkip.amazonaws.com", {
      method: "GET",
      dispatcher,
      signal: AbortSignal.timeout(10000)
    });
    console.log("HTTPS status:", res.status);
  } catch(e) {
    console.error("HTTPS Error:", e);
  }
}
run();
