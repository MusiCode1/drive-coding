# Cursor Agent hooks

Lifecycle: `sessionStart` via user `~/.cursor/hooks.json` or project `.cursor/hooks.json`.

| File | Role |
|---|---|
| `session-start.sh` | Hook script (docs-shaped JSON out) |
| `hooks.json.example` | Snippet to merge into Cursor hooks config |

## Behaviour

1. Drain Cursor stdin (`session_id`, `composer_mode`, …).
2. Call `../_shared/fetch-prompt.sh` (env gate + curl timeout).
3. On non-empty body → stdout:
   `{ "additional_context": "<prompt>" }`
4. Any miss → exit 0, empty stdout (normal CLI / BE down).

Wire preference when spawning via drive-coding ACP remains separate; this hook is
belt-and-suspenders for Cursor entry points that load `hooks.json`.

## Install (manual for now)

Merge `sessionStart` from `hooks.json.example` into `~/.cursor/hooks.json`
(or project `.cursor/hooks.json`). Adjust the absolute path if the repo moves.
Keep `timeout` low (2s); the script itself caps HTTP ~0.4s.
