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
| `agent acp` fires `sessionStart` under drive-coding | **NOT PROVEN HERE** (probe ENOENT) |

Reason: probe spawn of `/home/user/.local/bin/agent` failed with `ENOENT` in the
executor shell (BE log). Independently, `plans/pre-brief-cursor-sdk-acp-adapter.md`
already records that **`agent acp` does not load `hooks.json`**; reliable hook
delivery for Cursor is the SDK shim (out of scope for this slice).

⇒ Pipe is ready. Enabling under ACP = follow-up `cursor-sdk-acp`.


## Re-measured 2026-09-01 — now proven, and the answer is no

The 30/08 run could not prove it (the probe spawn hit `ENOENT`). Repeated on the
edge deployment with three CLIs, same BE, same env, one question each
(*"is there a section titled 'About drive-coding' in your context?"*):

| cliKind | hook wired | trace line | agent's answer |
|---|---|---|---|
| `cursor` (`agent acp`) | yes, `~/.cursor/hooks.json` | none | `NO-SURFACE` |
| `cursor-sdk` | same wiring | yes, at the first prompt | quoted the surface verbatim |
| `claude` | **no** — `~/.claude/settings.json` points elsewhere | none | `NO-SURFACE` |

⇒ Confirms what `plans/pre-brief-cursor-sdk-acp-adapter.md` already recorded:
**`agent acp` does not load `hooks.json`.** It is an upstream gap, not our wiring —
nothing to fix on our side.

**Consequence for the charter (slice `charter-in-hook`):** where the hook fires it
is the system-level channel, so `/api/agent-prompt` now serves the agent's charter
inside the same payload. Where it does not fire (`cliKind: cursor`), the charter
still arrives via `prependCharterToContent` on the first ACP turn — weaker
positioning (user-turn content), and `capabilities.systemPrompt` reports it
honestly as `"prepended"`.
