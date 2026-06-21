#!/bin/bash
proxies=$(curl -s https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt | head -n 20)
for p in $proxies; do
  echo "Testing $p..."
  http_code=$(curl --socks5 "$p" -s -o /dev/null -w "%{http_code}" --max-time 5 http://checkip.amazonaws.com)
  https_code=$(curl --socks5 "$p" -s -o /dev/null -w "%{http_code}" --max-time 5 https://checkip.amazonaws.com)
  echo "  HTTP: $http_code, HTTPS: $https_code"
done
