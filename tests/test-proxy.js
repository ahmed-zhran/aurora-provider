import { fetch as undiciFetch } from "undici";
import { socksDispatcher } from "fetch-socks";

async function test() {
  const options = {
    type: 5,
    host: "103.20.235.148", // A public SOCKS5 proxy, hopefully up. Or any.
    port: 1080
  };
  const dispatcher = socksDispatcher(options, { connect: { timeout: 2500 } });
  
  try {
    console.log("Fetching...");
    const res = await undiciFetch("https://checkip.amazonaws.com", {
      method: "GET",
      dispatcher,
      signal: AbortSignal.timeout(5000)
    });
    console.log("Status:", res.status);
    console.log("IP:", await res.text());
  } catch (err) {
    console.error("Error:", err);
  }
}
test();
