#!/usr/bin/env bash
# Build the public website into _site/ from an allowlist.
# Only what is listed here is served at siteplumb.com. Repo notes (*.md),
# scripts, tests, rules files and old builds stay private by never being copied.
# Add a new public page or asset here, or it will 404 on the live site.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-_site}"
rm -rf "$OUT"; mkdir -p "$OUT/app"

# Marketing site (root). sw.js here only retires the old root service worker.
ROOT_FILES=(index.html homeowners.html switch.html pitch-a.html pitch-b.html 404.html
  site.css sw.js CNAME .nojekyll
  apple-touch-icon.png icon-192.png icon-512.png icon-maskable-512.png)
ROOT_DIRS=(img)

# App files a phone needs.
APP_FILES=(index.html plumb.html p.html privacy.html terms.html manifest.json sw.js)
APP_DIRS=(tour-audio)

for f in "${ROOT_FILES[@]}"; do cp "$f" "$OUT/"; done
for d in "${ROOT_DIRS[@]}"; do cp -R "$d" "$OUT/"; done
for f in "${APP_FILES[@]}"; do cp "app/$f" "$OUT/app/"; done
for d in "${APP_DIRS[@]}"; do cp -R "app/$d" "$OUT/app/"; done

# Guards: parity must hold, and nothing private may slip in.
cmp "$OUT/app/index.html" "$OUT/app/plumb.html"
bad=$(cd "$OUT" && find . -type f \( -name '*.md' -o -name '*.mjs' -o -name '*.py' -o -name '*.rules' \
  -o -name 'sim.js' -o -name 'qa*.js' -o -name 'package*.json' -o -name '*.zip' -o -name '*.bin' \) | sort)
if [ -n "$bad" ]; then echo "Private files in the site build:"; echo "$bad"; exit 1; fi
echo "Site built in $OUT: $(find "$OUT" -type f | wc -l) files, $(du -sh "$OUT" | cut -f1)"
