# Claude Code hooks

Lifecycle: `SessionStart` (and optionally others) via `~/.claude/settings.json`
or a plugin `hooks/` entry.

Stdout shape (when injecting):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "…"
  }
}
```

Wire preference: ACP `_meta.systemPrompt.append` when the adapter supports it
(`capabilities.systemPrompt: true` for claude). This hook is belt-and-suspenders
+ non-ACP entry points, and carries the **runtime env table** from
`GET /api/agent-prompt?agent=`.

## Install

Merge a `SessionStart` entry from `settings.hooks.example.json` into
`~/.claude/settings.json` **alongside** any existing hooks (e.g. memory). Do not
replace the whole `hooks` object.

Adjust the `command` path to your checkout (worktree vs `dev`/`edge`).

## Scripts

- `session-start.sh` — fail-open fetch via `../_shared/fetch-prompt.sh`, jq wrap.
- Gate: requires `DRIVE_CODING_AGENT_ID` (normal Claude CLI → no-op).
- Trace: `DRIVE_CODING_HOOK_TRACE=1` → `/tmp/drive-coding-claude-session-start.log`
- Probe: `DRIVE_CODING_HOOK_PROBE=1` → prepends `SURFACE_CLAUDE_HOOK_ZQX7`

## Measurement

See `ACP-SESSIONSTART.md` for the live check under drive-coding in-process ACP.
