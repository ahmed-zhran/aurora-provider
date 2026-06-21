import tls from "tls";
import { SocksClient } from "socks";

async function run() {
  const options = {
    proxy: { ipaddress: "103.20.235.148", port: 1080, type: 5 },
    command: 'connect',
    destination: { host: 'checkip.amazonaws.com', port: 443 }
  };
  
  try {
    const info = await SocksClient.createConnection(options);
    console.log("SOCKS connected");
    
    const socket = tls.connect({
      socket: info.socket,
      servername: 'checkip.amazonaws.com'
    });
    
    socket.on('secureConnect', () => {
      console.log("TLS connected!");
      socket.write("GET / HTTP/1.1\r\nHost: checkip.amazonaws.com\r\nConnection: close\r\n\r\n");
    });
    
    socket.on('data', d => console.log("DATA:", d.toString()));
    socket.on('error', e => console.log("ERR:", e));
  } catch(e) { console.error("SOCKS ERR:", e); }
}
run();
