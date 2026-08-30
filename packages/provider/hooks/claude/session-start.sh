#!/usr/bin/env bash
# Claude Code SessionStart hook — drive-coding surface / system instructions.
#
# Docs: https://docs.claude.com/en/docs/claude-code/hooks
#   stdin:  SessionStart hook input JSON (drained; unused for now)
#   stdout: {
#     "hookSpecificOutput": {
#       "hookEventName": "SessionStart",
#       "additionalContext": "<text>"
#     }
#   }
#
# Fail-open: no agent id / BE down / timeout / empty / HTML / no jq → exit 0, no stdout.
#
# Optional:
#   DRIVE_CODING_HOOK_TRACE=1  → append one line to /tmp/drive-coding-claude-session-start.log
#   DRIVE_CODING_HOOK_PROBE=1  → prepend SURFACE_CLAUDE_HOOK_ZQX7 (live visibility test)

set -u

if [[ "${DRIVE_CODING_HOOK_TRACE:-}" == "1" ]]; then
  printf '%s agent=%s base=%s probe=%s\n' "$(date -Iseconds 2>/dev/null || date)" \
    "${DRIVE_CODING_AGENT_ID:-}" "${DRIVE_CODING_BASE:-${DC_BASE:-}}" \
    "${DRIVE_CODING_HOOK_PROBE:-}" \
    >>/tmp/drive-coding-claude-session-start.log 2>/dev/null || true
fi

# Drain stdin (Claude passes hook input JSON).
if [[ ! -t 0 ]]; then
  cat >/dev/null 2>&1 || true
fi

# Outside drive-coding → no-op (normal CLI / other hosts untouched).
[[ -n "${DRIVE_CODING_AGENT_ID:-}" ]] || exit 0

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FETCH="$HERE/../_shared/fetch-prompt.sh"
[[ -x "$FETCH" || -f "$FETCH" ]] || exit 0

CONTEXT="$("$FETCH")" || exit 0

if [[ "${DRIVE_CODING_HOOK_PROBE:-}" == "1" ]]; then
  marker="SURFACE_CLAUDE_HOOK_ZQX7"
  if [[ -n "$CONTEXT" ]]; then
    CONTEXT="${marker}"$'\n\n'"${CONTEXT}"
  else
    CONTEXT="${marker}"$'\n\n'"# drive-coding SessionStart probe"$'\n'"If you can read SessionStart additionalContext, quote ${marker}."
  fi
fi

[[ -n "$CONTEXT" ]] || exit 0

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

jq -n --arg ctx "$CONTEXT" \
  '{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: $ctx } }'
exit 0
