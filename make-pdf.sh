#!/usr/bin/env bash
# Generira report.html pa ga renderira u PDF (Chrome/Brave headless).
# Pokretanje:  ./make-pdf.sh   (ili: bash make-pdf.sh)
set -euo pipefail
cd "$(dirname "$0")"

node pkk-report.mjs

CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  [ -x "$c" ] && CHROME="$c" && break
done
if [ -z "$CHROME" ]; then
  echo "Nije nađen Chrome/Brave/Chromium. Otvori report.html i ispiši u PDF ručno (Cmd+P)."
  exit 1
fi

OUT="$PWD/${PKK_OUT:-javna-davanja.pdf}"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$OUT" "file://$PWD/report.html" >/dev/null 2>&1
echo "✓ $OUT"
