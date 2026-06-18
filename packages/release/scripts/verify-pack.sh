#!/usr/bin/env bash
# packages/release/scripts/verify-pack.sh
# End-to-end verification: packs the release tarball, installs it in a clean
# temp directory via bun add, starts the server with bunx, and checks HTTP responses.
# Usage: bash scripts/verify-pack.sh
set -euo pipefail

cd "$(dirname "$0")/.."   # packages/release/

# ---- Step 0: fresh pack (triggers prepack=build.mjs) ----
echo "[verify] packing..."
# Note: bun build writes files only when stdio is inherited (TTY/pipe with inherit).
# Using npm pack without 2>&1 redirect to preserve stdio inheritance for bun subprocess.
npm pack
TGZ="$(pwd)/drive-coding-0.1.0.tgz"

# ---- Step 1: tarball structure checks ----
echo "[verify] checking tarball contents..."
tar -tzf "$TGZ" | grep -q 'package/dist/drive-coding.js'     || { echo "FAIL: missing dist/drive-coding.js"; exit 1; }
tar -tzf "$TGZ" | grep -q 'package/frontend-dist/index.html' || { echo "FAIL: missing frontend-dist/index.html"; exit 1; }
tar -tzf "$TGZ" | grep -q 'package/plugins/'                 || { echo "FAIL: missing plugins/"; exit 1; }
tar -tzf "$TGZ" | grep -qE 'node_modules|\.pnpm|provider-abstraction' && { echo "FAIL: workspace/git leak in tarball"; exit 1; } || true
echo "[verify] tarball structure OK ✓"

# ---- Step 2: clean install via bun add ----
TMP="$(mktemp -d)"
echo "[verify] installing into $TMP..."
cd "$TMP"
# bun init creates a minimal package.json so bun add works
bun init -y >/dev/null 2>&1 || true
bun add "$TGZ"
test -e node_modules/.bin/drive-coding || { echo "FAIL: node_modules/.bin/drive-coding missing"; exit 1; }
echo "[verify] bun add OK ✓"

# ---- Step 3: start server ----
PORT="${VERIFY_PORT:-4003}"
echo "[verify] starting bunx drive-coding on port $PORT..."
# Use env -u FE_STATIC_DIR so the cascade picks up frontend-dist from the package
# (not an empty string which would bypass ??)
env -u FE_STATIC_DIR PORT="$PORT" bunx drive-coding &
SERVER_PID=$!
# give the server a moment to boot
sleep 4

# cleanup on exit
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  cd /tmp
  rm -rf "$TMP" 2>/dev/null || true
}
trap cleanup EXIT

# ---- Step 4: HTTP checks ----
echo "[verify] GET / ..."
HTTP_ROOT=$(curl -fsS -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" || true)
echo "GET / → $HTTP_ROOT"
[ "$HTTP_ROOT" = "200" ] || { echo "FAIL: GET / returned $HTTP_ROOT (expected 200)"; exit 1; }

echo "[verify] GET /api/agents ..."
AGENTS_BODY=$(curl -fsS "http://localhost:$PORT/api/agents" 2>/dev/null || true)
echo "GET /api/agents → $AGENTS_BODY"
echo "$AGENTS_BODY" | grep -q '"agents"' || { echo "FAIL: /api/agents did not return {agents:...}"; exit 1; }

echo ""
echo "[verify] ALL CHECKS PASSED ✓"
echo "  - tarball structure: dist/ frontend-dist/ plugins/ present, no leak"
echo "  - bun add \$TGZ → exit 0"
echo "  - node_modules/.bin/drive-coding exists"
echo "  - GET / → 200"
echo "  - GET /api/agents → {agents:...}"
