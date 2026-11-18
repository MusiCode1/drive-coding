# Qoder CLI hooks

Claude-compatible hook surface (`qodercli hooks migrate --from-claude`).

Prefer the same SessionStart + `additionalContext` pattern as Claude once
scripts land. Wire fallback: `--append-system-prompt` on spawn.

Scripts: TBD — call `../_shared/fetch-prompt.sh`, wrap JSON, exit 0 on empty.
