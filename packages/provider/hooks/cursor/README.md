# Cursor Agent hooks

Lifecycle: `sessionStart` via user `~/.cursor/hooks.json` or project `.cursor/hooks.json`.

| File | Role |
|---|---|
| `session-start.sh` | Hook script (docs-shaped JSON out) |
| `hooks.json.example` | Snippet to merge into Cursor hooks config |

## Behaviour

1. Drain Cursor stdin (`session_id`, `composer_mode`, …).
2. Call `../_shared/fetch-prompt.sh`:
   - requires `DRIVE_CODING_AGENT_ID`
   - base = `DRIVE_CODING_BASE` / `DC_BASE`, else `http://127.0.0.1:$PORT`
   - `GET {base}/api/agent-prompt?agent=<id>`
   - accepts only `text/plain` 200; rejects HTML
3. On non-empty body → stdout:
   `{ "additional_context": "<prompt>" }`
4. Any miss → exit 0, empty stdout (normal CLI / BE down).

Wire preference when spawning via drive-coding ACP remains separate; this hook is
belt-and-suspenders for Cursor entry points that load `hooks.json`.

⚠️ **`agent acp` may not fire `sessionStart`** (see `pre-brief-cursor-sdk-acp-adapter.md`).
Set `DRIVE_CODING_HOOK_TRACE=1` on the child to log hits to
`/tmp/drive-coding-session-start.log` when measuring.

## Install (manual for now)

Merge a `sessionStart` entry from `hooks.json.example` into `~/.cursor/hooks.json`
**alongside** any existing hooks (do not replace the memory hook). Adjust the
absolute path if the worktree/repo moves. Keep `timeout` low (2s); the script
itself caps HTTP ~0.4s.
