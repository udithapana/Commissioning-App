#!/usr/bin/env bash
# Builds the app from src/ into:
#   dist/artifact.html  page body for a Claude artifact (shared database + downloads capabilities)
#   index.html          standalone page (works offline from a file or on GitHub Pages; data stays in the browser)
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/gen_assets.py
mkdir -p dist
JS="src/10-core.js src/11-logo.js src/12-template.js src/20-storage-ui.js src/30-serials-photos.js src/40-history-backup.js src/50-excel.js src/60-actions-pdf.js"
{ cat src/00-shell.html
  echo '<script src="https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>'
  echo '<script>'; cat $JS; echo '</script>'; } > dist/artifact.html
python3 - <<'P'
s = open('dist/artifact.html', encoding='utf-8').read()
head = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
open('index.html', 'w', encoding='utf-8').write(head + s.replace('<div id="app"></div>', '</head><body><div id="app"></div>', 1) + '\n</body></html>\n')
P
for f in $JS; do node --check "$f"; done
echo "built dist/artifact.html and index.html ($(wc -c < index.html) bytes)"
