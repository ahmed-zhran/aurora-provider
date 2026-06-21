import tls from "tls";
import { SocksClient } from "socks";
import { fetch as undiciFetch } from "undici";

async function run() {
  const listRes = await undiciFetch("https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt");
  const text = await listRes.text();
  const proxies = text.split('\n').map(l => l.trim()).filter(l => l);
  const sample = proxies.slice(0, 20);
  
  let passed = 0;
  
  await Promise.all(sample.map(async pStr => {
    const [host, port] = pStr.split(':');
    return new Promise(resolve => {
      let isDone = false;
      const done = (r) => { if(!isDone){ isDone=true; resolve(r); } };
      
      setTimeout(() => done(false), 5000); // timeout
      
      SocksClient.createConnection({
        proxy: { ipaddress: host, port: parseInt(port), type: 5 },
        command: 'connect',
        destination: { host: 'checkip.amazonaws.com', port: 443 },
        timeout: 4000
      }).then(info => {
        const socket = tls.connect({ socket: info.socket, servername: 'checkip.amazonaws.com' });
        socket.on('secureConnect', () => {
          socket.write("GET / HTTP/1.1\r\nHost: checkip.amazonaws.com\r\nConnection: close\r\n\r\n");
        });
        socket.on('data', d => {
          if (d.toString().includes("HTTP/1.1 200")) {
            passed++;
            done(true);
          }
        });
        socket.on('error', () => done(false));
      }).catch(() => done(false));
    });
  }));
  
  console.log("Direct TLS passed:", passed);
}
run();
