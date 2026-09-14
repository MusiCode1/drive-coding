#!/usr/bin/env bash
# Cursor hook — inject drive-coding surface / system prompt wherever the schema allows.
#
# Docs: https://cursor.com/docs/agent/hooks
#   sessionStart               → stdout { additional_context }  (primary surface)
#   stop / subagentStop        → stdout { followup_message }  (next user message)
#   Do NOT wire stop/subagentStop for surface — floods chat as fake user msgs
#   (2026-08-30). postToolUse was a #61 workaround — also removed (HAC).
#
# Fail-open: no agent id / BE down / timeout / empty / HTML → exit 0, no stdout.
#
# Optional: DRIVE_CODING_HOOK_TRACE=1 → append to /tmp/drive-coding-session-start.log

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FETCH="$HERE/../_shared/fetch-prompt.sh"

INPUT=""
if [[ ! -t 0 ]]; then
  INPUT="$(cat 2>/dev/null || true)"
fi

EVENT=""
if [[ -n "$INPUT" ]] && command -v jq >/dev/null 2>&1; then
  EVENT="$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null || true)"
fi
# argv override: inject-prompt.sh stop | postToolUse | …
if [[ -n "${1:-}" ]]; then
  EVENT="$1"
fi

if [[ "${DRIVE_CODING_HOOK_TRACE:-}" == "1" ]]; then
  printf '%s event=%s agent=%s base=%s\n' "$(date -Iseconds 2>/dev/null || date)" \
    "${EVENT:-?}" "${DRIVE_CODING_AGENT_ID:-}" "${DRIVE_CODING_BASE:-${DC_BASE:-}}" \
    >>/tmp/drive-coding-session-start.log 2>/dev/null || true
fi

[[ -x "$FETCH" || -f "$FETCH" ]] || exit 0

CONTEXT="$("$FETCH")" || exit 0
[[ -n "$CONTEXT" ]] || exit 0

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

case "$EVENT" in
  stop | subagentStop)
    jq -n --arg ctx "$CONTEXT" '{ followup_message: $ctx }'
    ;;
  *)
    # sessionStart, postToolUse, unknown → additional_context
    jq -n --arg ctx "$CONTEXT" '{ additional_context: $ctx }'
    ;;
esac
exit 0
