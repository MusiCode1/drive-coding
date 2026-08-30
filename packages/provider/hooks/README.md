# Provider hooks — per-CLI adapters for surface / system instructions

Thin, fail-open scripts that run **outside** the drive-coding process (Claude /
Cursor / Codex command hooks are spawned subprocesses). They:

1. Detect drive-coding via env (e.g. `DRIVE_CODING_BASE` / `DC_BASE`).
2. If absent → exit 0 immediately (normal CLI use untouched).
3. If present → short HTTP fetch to the BE for composed prompt text, then print
   the CLI-specific hook JSON on stdout.

**Not** vendored ACP forks (`@Vendor/`). **Not** shared prompt text (that lives
in `packages/backend/src/prompts/`). This tree is only the per-provider glue.

## Layout

```
hooks/
  README.md          ← this file
  _shared/           ← optional helpers later (curl wrapper, env gate)
  claude/
  cursor/
  codex/
  opencode/          ← note: production path today is plugins/prompt-injector
  qoder/
  grok/              ← no lifecycle hooks API — placeholder / future argv notes
  gemini/
```

## Fail-open contract (mandatory)

A hung or dead backend must **never** stall a normal agent turn. Implement every
hook with **all** of:

| Rule | Why |
|---|---|
| Gate on env first | No BE URL → exit 0 before any I/O |
| Hard timeout (~200–500ms) | `curl --max-time`, `fetch`+`AbortSignal`, etc. |
| Treat any failure as empty | Non-2xx, DNS fail, timeout, bad JSON → exit 0, no stdout context |
| Prefer non-blocking events when the CLI offers them | e.g. Cursor `sessionStart` is fire-and-forget; still keep the timeout |
| Never `failClosed` / exit 2 for “BE down” | That would block the user |

See the design notes in the investigation §8 and the surface-prompt discussion
(2026-08-29): ACP-native injection first; hooks as belt-and-suspenders + HTTP
dumb client.

## Install (later)

Global/project `hooks.json` will point at these scripts. Until install exists,
directories are scaffolding only.
