# Measurement — does `agent acp` fire Cursor `sessionStart`?

> Date: 2026-08-30 · Slice: `surface-prompt-hooks` · Base: `cb0fd797`

## Setup for a live re-check

1. Merge `sessionStart` from
   `packages/provider/hooks/cursor/hooks.json.example` into `~/.cursor/hooks.json`
   (keep existing memory hook).
2. `export DRIVE_CODING_HOOK_TRACE=1` in the BE process env (so children inherit it),
   or inject via `session_open` / create `env`.
3. Truncate `/tmp/drive-coding-session-start.log`.
4. Open a Cursor agent through drive-coding (`cliKind: cursor`).
5. If the log gains a line with `agent=<uuid>`, `sessionStart` ran.

## Result in this slice run (30/08)

| Check | Result |
|---|---|
| `GET /api/agent-prompt?agent=` → `text/plain` with About + env table | **PASS** (vitest `http-agent-prompt.test.ts`) |
| Hook fail-open on dead BE | **PASS** (manual: exit 0, empty stdout) |
| `createAndSpawn` forces loopback `DRIVE_CODING_BASE`/`DC_BASE` | **PASS** (vitest orchestrator) |
| `agent acp` fires `sessionStart` under drive-coding | **NOT PROVEN HERE** |

Reason: probe spawn of `/home/user/.local/bin/agent` failed with `ENOENT` in the
executor shell (BE log). Independently, `plans/pre-brief-cursor-sdk-acp-adapter.md`
already records that **`agent acp` does not load `hooks.json`**; reliable hook
delivery for Cursor is the SDK shim (out of scope for this slice).

⇒ Pipe is ready. Enabling under ACP = follow-up `cursor-sdk-acp`.
