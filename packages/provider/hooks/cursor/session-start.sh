#!/usr/bin/env bash
# Cursor sessionStart hook — drive-coding surface / system instructions.
#
# Docs: https://cursor.com/docs/hooks  (sessionStart)
#   stdin:  { session_id, is_background_agent, composer_mode? }
#   stdout: { additional_context?: string, env?: { … } }
#
# Fail-open: no DRIVE_CODING_BASE / BE down / timeout / empty → exit 0, no stdout.
# sessionStart is fire-and-forget in Cursor; we still use a hard curl timeout.

set -u

# Drain stdin (required schema fields; unused for now).
if [[ ! -t 0 ]]; then
  cat >/dev/null 2>&1 || true
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FETCH="$HERE/../_shared/fetch-prompt.sh"
[[ -x "$FETCH" || -f "$FETCH" ]] || exit 0

CONTEXT="$("$FETCH")" || exit 0
[[ -n "$CONTEXT" ]] || exit 0

# Prefer jq (safe JSON string escape). Without it — refuse to guess escaping.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

jq -n --arg ctx "$CONTEXT" '{ additional_context: $ctx }'
exit 0
