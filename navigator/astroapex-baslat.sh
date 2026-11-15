#!/bin/sh
# AstroApex - macOS / Linux baslatici.   Calistirma:  sh astroapex-baslat.sh
# Python 3 varsa yerel sunucuyu baslatir ve tarayiciyi acar; yoksa siteyi dogrudan acar.
cd "$(dirname "$0")" || exit 1

if command -v python3 >/dev/null 2>&1; then
  exec python3 server.py --open
fi

echo "Python 3 bulunamadi; site dogrudan tarayicida aciliyor."
if command -v open >/dev/null 2>&1; then open index.html
elif command -v xdg-open >/dev/null 2>&1; then xdg-open index.html
else echo "index.html dosyasini tarayicinizda acin."
fi
