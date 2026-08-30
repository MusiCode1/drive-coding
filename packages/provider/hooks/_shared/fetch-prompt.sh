#!/usr/bin/env bash
# Shared fail-open fetch for drive-coding surface / system prompt hooks.
#
# Usage: fetch-prompt.sh
# Env:
#   DRIVE_CODING_BASE or DC_BASE  — BE origin (required to do anything)
#   DRIVE_CODING_PROMPT_PATH      — path under base (default: /api/agent-prompt)
#   DRIVE_CODING_PROMPT_TIMEOUT_S — curl max-time seconds (default: 0.4)
#
# stdout: prompt body on success (2xx + non-empty)
# exit 0 always — never blocks the CLI on BE failure.

set -u

base="${DRIVE_CODING_BASE:-${DC_BASE:-}}"
if [[ -z "$base" ]]; then
  exit 0
fi

path="${DRIVE_CODING_PROMPT_PATH:-/api/agent-prompt}"
timeout_s="${DRIVE_CODING_PROMPT_TIMEOUT_S:-0.4}"
url="${base%/}${path}"

# --max-time: hard ceiling. --connect-timeout: fail fast if nothing listens.
# -f: HTTP errors → fail (we discard). || true: never non-zero exit.
body="$(
  curl -fsS --connect-timeout "$timeout_s" --max-time "$timeout_s" "$url" 2>/dev/null
)" || exit 0

[[ -n "$body" ]] || exit 0
printf '%s' "$body"
exit 0
