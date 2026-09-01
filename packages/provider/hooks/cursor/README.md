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

⚠️ **`cliKind: cursor` does NOT fire `sessionStart`; `cursor-sdk` does.**
Measured live 2026-09-01 on the edge deployment, same BE, same env:

| cliKind | hook wired | trace hit | agent sees the surface |
|---|---|---|---|
| `cursor` (`agent acp`) | yes, `~/.cursor/hooks.json` | no | **no** — answered `NO-SURFACE` |
| `cursor-sdk` (HAC vendor) | same wiring | yes, at first prompt | **yes** — quoted it verbatim |
| `claude` | **no — `~/.claude/settings.json` never points here** | no | **no** — answered `NO-SURFACE` |

⇒ Of the three measured CLIs, **only `cursor-sdk` receives the surface through
hooks.** `hooks/claude/session-start.sh` has exactly one trace line ever, from
the day it was written (2026-08-30, a manual `probe=1`). The wiring lives in
per-machine files outside this repo, so "the script exists" says nothing about
whether anything reaches the model.

So for `cliKind: cursor` the surface must arrive by another channel; this hook
does not reach it. See `pre-brief-cursor-sdk-acp-adapter.md`. Set `DRIVE_CODING_HOOK_TRACE=1` on the child to log hits to
`/tmp/drive-coding-session-start.log` when measuring.

## Install (manual for now)

Merge `sessionStart` / `stop` / `subagentStop` from `hooks.json.example` into
`~/.cursor/hooks.json` **alongside** any existing hooks (do not replace the memory
hook). Adjust the absolute path if the worktree/repo moves. Keep `timeout` low;
the script itself caps HTTP ~0.4s.
