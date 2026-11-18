# Measurement — does drive-coding Claude ACP fire `SessionStart`?

> Date: 2026-08-30 · Slice: `surface-prompt-hooks` · Base: worktree `surface-prompt-hooks`

## Setup

1. Merge a `SessionStart` entry from `settings.hooks.example.json` into
   `~/.claude/settings.json` **alongside** existing hooks (do not replace).
2. Point `command` at this tree's `session-start.sh`.
3. Start a probe BE with child env:
   - `DRIVE_CODING_HOOK_TRACE=1`
   - `DRIVE_CODING_HOOK_PROBE=1` (prepends `SURFACE_CLAUDE_HOOK_ZQX7`)
4. Truncate `/tmp/drive-coding-claude-session-start.log`.
5. `session_open` / spawn `cliKind: claude` through that BE.
6. Ask the agent whether it sees `SURFACE_CLAUDE_HOOK_ZQX7`.

## Result (30/08) — **PASS**

| Check | Result |
|---|---|
| Hook subprocess ran (trace log line with `agent=<uuid>`) | **PASS** |
| Model quoted `SEEN:SURFACE_CLAUDE_HOOK_ZQX7` | **PASS** |
| Model also reported surface/display notes (fetch body) | **PASS** (`yes`) |
| Fail-open without `DRIVE_CODING_AGENT_ID` (empty stdout) | **PASS** (smoke) |

Probe BE: `PORT=4374`, agent `0e9daa3a-d000-4d95-9747-2da50ce61654`.
Trace line:

```text
2026-08-30T12:15:54+03:00 agent=0e9daa3a-d000-4d95-9747-2da50ce61654 base=http://127.0.0.1:4374 probe=1
```

`~/.claude/settings.json` was restored after the run (memory hook only).

## Notes

- Claude under drive-coding is **in-process ACP** (`claude-agent-acp`) with
  `settingSources: ["user","project","local"]` — user `settings.json` hooks load.
- Contrast: Cursor `agent acp` + `hooks.json` remains **unproven / suspected no**
  (see `../cursor/ACP-SESSIONSTART.md`).
- Production install still needs a stable path (not a worktree path) and should
  not leave `DRIVE_CODING_HOOK_PROBE` on.
