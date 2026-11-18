#!/usr/bin/env bash
# Shared fail-open fetch for drive-coding surface / system prompt hooks.
#
# Usage: fetch-prompt.sh
# Env:
#   DRIVE_CODING_AGENT_ID         — agent uuid (required for a non-empty fetch)
#   DRIVE_CODING_BASE or DC_BASE  — BE origin (preferred)
#   PORT                          — fallback loopback when BASE unset but agent id set
#   DRIVE_CODING_PROMPT_PATH      — path under base (default: /api/agent-prompt)
#   DRIVE_CODING_PROMPT_TIMEOUT_S — curl max-time seconds (default: 0.4)
#
# stdout: prompt body on success (2xx + text/plain + non-empty)
# exit 0 always — never blocks the CLI on BE failure.

set -u

agent_id="${DRIVE_CODING_AGENT_ID:-}"
if [[ -z "$agent_id" ]]; then
  exit 0
fi

base="${DRIVE_CODING_BASE:-${DC_BASE:-}}"
if [[ -z "$base" ]]; then
  port="${PORT:-}"
  if [[ -n "$port" ]]; then
    base="http://127.0.0.1:${port}"
  else
    exit 0
  fi
fi

path="${DRIVE_CODING_PROMPT_PATH:-/api/agent-prompt}"
timeout_s="${DRIVE_CODING_PROMPT_TIMEOUT_S:-0.4}"
url="${base%/}${path}?agent=${agent_id}"

tmp="$(mktemp 2>/dev/null)" || exit 0
trap 'rm -f "$tmp" "$tmp.hdr" 2>/dev/null' EXIT

# -D headers, -o body, -f fail on HTTP errors, hard timeouts.
code="$(
  curl -sS -f \
    --connect-timeout "$timeout_s" \
    --max-time "$timeout_s" \
    -D "$tmp.hdr" \
    -o "$tmp" \
    "$url" \
    -w '%{http_code}' 2>/dev/null
)" || exit 0

[[ "$code" == "200" ]] || exit 0

ctype="$(
  tr -d '\r' <"$tmp.hdr" 2>/dev/null \
    | awk 'tolower($1)=="content-type:"{print tolower($0); exit}'
)" || true
case "$ctype" in
  *text/plain*) ;;
  *) exit 0 ;;
esac

# Reject FE SPA fallback / accidental HTML.
if head -c 32 "$tmp" 2>/dev/null | grep -qi '<!doctype\|<html'; then
  exit 0
fi

[[ -s "$tmp" ]] || exit 0
cat "$tmp"
exit 0
