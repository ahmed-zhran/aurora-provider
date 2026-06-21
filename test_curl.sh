#!/bin/bash
PROXIES=$(curl -s https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt | head -n 20)
for p in $PROXIES; do
  echo "Testing $p"
  curl -x socks5h://$p https://checkip.amazonaws.com -m 3
  if [ $? -eq 0 ]; then
    echo "SUCCESS: $p"
  fi
done
