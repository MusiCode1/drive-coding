# Cursor Agent hooks

Lifecycle: inject drive-coding surface where Cursor accepts prompt-ish output.

| Event | Script output | Role |
|---|---|---|
| `sessionStart` | `{ additional_context }` | **Primary** surface inject (once per session) |
| `stop` / `subagentStop` | `{ followup_message }` | Optional re-nudge as next user message |
| ~~`postToolUse`~~ | — | **Removed 2026-08-30** — was a #61 workaround while `@cursor/sdk` dropped `sessionStart` `additional_context`. With HAC vendor (`1.0.30-hac.0`) sessionStart is enough; re-injecting after every tool was noisy and redundant. |

User `~/.cursor/hooks.json` and/or project `.cursor/hooks.json`.

| File | Role |
|---|---|
| `inject-prompt.sh` | Shared hook (event via argv or `hook_event_name`) |
| `session-start.sh` | Back-compat → `inject-prompt.sh sessionStart` |
| `hooks.json.example` | Snippet to merge into Cursor hooks config |

## Behaviour

1. Drain Cursor stdin (`session_id`, `composer_mode`, …).
2. Call `../_shared/fetch-prompt.sh`:
   - requires `DRIVE_CODING_AGENT_ID`
   - base = `DRIVE_CODING_BASE` / `DC_BASE`, else `http://127.0.0.1:$PORT`
   - `GET {base}/api/agent-prompt?agent=<id>`
   - accepts only `text/plain` 200; rejects HTML
3. On non-empty body → stdout JSON as above.
4. Any miss → exit 0, empty stdout (normal CLI / BE down).

Wire preference when spawning via drive-coding ACP remains separate; this hook is
belt-and-suspenders for Cursor entry points that load `hooks.json`.

⚠️ **`agent acp` may not fire `sessionStart`** (see `pre-brief-cursor-sdk-acp-adapter.md`).
`cursor-sdk` + HAC does. Set `DRIVE_CODING_HOOK_TRACE=1` on the child to log hits to
`/tmp/drive-coding-session-start.log` when measuring.

## Install (manual for now)

Merge `sessionStart` / `stop` / `subagentStop` from `hooks.json.example` into
`~/.cursor/hooks.json` **alongside** any existing hooks (do not replace the memory
hook). Adjust the absolute path if the worktree/repo moves. Keep `timeout` low;
the script itself caps HTTP ~0.4s.
