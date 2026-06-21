#!/bin/bash
proxies=$(curl -s "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=all" | head -n 100)
passed=0
for p in $proxies; do
  p=$(echo "$p" | tr -d '\r')
  https_code=$(curl --socks5-hostname "$p" -s -o /dev/null -w "%{http_code}" --max-time 3 https://checkip.amazonaws.com)
  if [ "$https_code" == "200" ]; then
    echo "SUCCESS: $p"
    passed=$((passed+1))
  fi
done
echo "Total passed HTTPS: $passed"
