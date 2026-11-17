#!/usr/bin/env bash
# Stage public/lab as a standalone media site and deploy it to Cloudflare Pages.
# First time:  npx wrangler login && npx wrangler pages project create moonwtr-media --production-branch main
# Then:        bash scripts/publish-media.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=media-dist
rm -rf "$OUT" && mkdir -p "$OUT"
cp -R public/lab "$OUT/lab"
cat > "$OUT/_headers" <<'H'
/lab/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=86400
H
npx --yes wrangler pages deploy "$OUT" --project-name moonwtr-media --branch main --commit-dirty=true
