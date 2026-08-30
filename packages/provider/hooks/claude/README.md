# Claude Code hooks

Lifecycle: `SessionStart` (and optionally others) via `~/.claude/settings.json`
or a plugin `hooks/` entry.

Stdout shape (when injecting): Claude `hookSpecificOutput.additionalContext` JSON.

Wire preference: ACP `_meta.systemPrompt.append` when the adapter supports it;
this hook is belt-and-suspenders + non-ACP entry points.

Scripts: TBD — call `../_shared/fetch-prompt.sh`, wrap JSON, exit 0 on empty.
