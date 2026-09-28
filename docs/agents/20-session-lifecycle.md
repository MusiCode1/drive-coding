---
id: session-lifecycle
title: Session lifecycle — open, send, close
summary: How to spawn an agent, drive a turn and release it, including who owns the session.
read_when:
  - You need to spawn an agent and get its id
  - A turn is running and you must decide between waiting and forcing
  - You are about to leave an agent open and want to know who owns it
tags: [session, ownership, turnstate]
surface: [http, mcp]
stability: stable
routes:
  - GET /api/agents
  - POST /api/agents
  - GET /api/agents/:id
  - DELETE /api/agents/:id
  - PATCH /api/agents/:id
  - POST /api/agents/:id/presence
mcp_tools:
  - session_list
  - session_open
  - session_send
  - session_state
  - session_close
docs_version: 1.0.0
updated: 2026-09-28
---

# Session lifecycle

**You open it, you close it.** Whoever creates an agent is responsible for closing it
when work finishes — including when a turn is already running.

## Typical MCP workflow

1. **session_list** — agents already on this backend (`id`, `cliKind`, `cwd`, `turnState`, …).
   Same data as `GET /api/agents`.
2. **session_open** — spawn with `cli` + absolute `cwd`; blocks up to ~30s for `sessionId`.
   Returns `agent` UUID, `url`, live `modes` and `configOptions` catalog, plus a configure hint.
3. **session_send** — user prompt; waits for turn end by default (1800s cap) unless `noWait`
   or timeout. Optional `sets` applies config before the prompt (see `30-child-config`).
4. **session_state** — read `turnState`, errors, catalog without pulling full message logs.
5. **session_close** — delete record and kill CLI; refuses when `turnState !== idle` unless
   `force: true`.

Re-use an existing agent from **session_list** instead of spawning duplicates.

HTTP mirrors the same lifecycle: `POST /api/agents` (create), agent-scoped routes under
`/api/agents/:id/…`, `DELETE /api/agents/:id` (close).

## Open (spawn)

Required inputs:

- **`cli`** — ACP CLI kind (`cursor`, `claude`, `codex`, `opencode`, …).
- **`cwd`** — absolute working directory for the child.

Optional highlights:

- **`permission`** — policy for the new agent (`allow_once`, `allow_always`, `reject_once`, `ask`).
- **`parent`** / header **`X-Drive-Coding-Agent`** — sub-agent wiring (`parentAgentId`).
- **`closeOnTurnEnd`** — auto-close after first clean turn end.
- **`publicUrl` / `base`** — backend URL used to build chat links and child env.

MCP **`session_open`** returns `{ agent, sessionId, url, cli, modes, configOptions, hint }`.
The hint explains that **`sets` on session_send** must use ids from that catalog.

## Send (drive a turn)

**session_send** (and HTTP RPC `session/prompt`) runs a turn.

- Default: block until the turn ends or **`timeoutSec`** (default 1800).
- **`noWait: true`** → immediate `{ running: true }`; fetch output via **session_state**,
  `GET /api/agents/:id/history`, or SSE (`40-reading-output`).
- While **`turnState` is not `idle`**, another blocking send may queue or conflict — inspect
  state before forcing.

When **`turnState !== idle`**:

- **session_close** / `DELETE` / CLI `close` **refuse** unless **`force: true`** (or CLI
  `--force`). Prefer waiting for idle unless you accept a hard stop.
- Closing with force while a turn runs still kills the process; log may record prior turn state.

## Close

**session_close** calls the same **`deleteAndKill`** path as `DELETE /api/agents/:id` and
`drive-coding agent close`.

- Missing agent → MCP may return `{ ok: true, alreadyClosed: true }`; HTTP DELETE → 404.

Closing an agent — `DELETE /api/agents/:id`, **session_close**, or `drive-coding agent close`
— all reach the same **`deleteAndKill`** and close **that agent only**. Children linked by
**`parentAgentId` are not** closed with it: they keep running and you must close each one
yourself (`agent-orchestrator.ts:260-284` · `http-agents.ts:135-142`).

Scope note: MCP tool copy states **no ownership check on session_close** (any id may be
closed), while server instructions also describe scoped writes for subtree — see report
§11 divergence 1; stage-3 scope doc is authoritative for guard rails.

## Ownership and liveness (HTTP session host)

The chat UI holds an **HTTP owner** for SSE/event streaming. Liveness is proven by
**`POST /api/agents/:id/presence`** (empty body) on a visible heartbeat interval (~12s in
the product UI). Optional header ties the heartbeat to a connection row.

If a connection stops signaling within **`HTTP_OWNER_TTL_MS`** (config key
`httpOwnerTtlMs`, env **`HTTP_OWNER_TTL_MS`**, product default 600000 ms = 10 minutes),
the backend **drops the stale HTTP connection row**; implementation retains the holder
record while removing the connection — do not assume ownership release equals agent deletion.

**GET** routes such as **`/history`** and **`/state`** do **not** count as liveness signals.

SSE **`GET /api/agents/:id/events`**: stale `?epoch=` → **409** before attach; lost ownership
→ **`taken-over`** event. See `40-reading-output`.

## Identity header

MCP requests from spawned children may include **`X-Drive-Coding-Agent: <uuid>`** for
caller identity (`parentAgentId` on open, **notify_parent** eligibility). **session_whoami**
returns your id and runtime envelope — the server does not guess from env alone.

## Configure during lifecycle

Do not guess option names at open/send time — read **`configOptions`** and **`modes`** from
**session_open** / **session_state**, then pass **`sets`** on **session_send**. Details in
`30-child-config`.

## CLI equivalents

```bash
drive-coding agent list [--json]
drive-coding agent open --cli cursor [--cwd DIR] [--parent ID] [--close-on-turn-end]
drive-coding agent send --agent ID --prompt-file FILE [--set id=value]
drive-coding agent state --agent ID
drive-coding agent close --agent ID [--force]
```

`open` injects **`DRIVE_CODING_BASE`** and **`DC_BASE`** into the child; with `--parent`,
also **`DC_PARENT`**.

## Limits (MCP)

- Stateless — poll **session_state** or use HTTP SSE for live updates.
- **session_send** ignores CLI-only fields (`file`, `marker`, `idleTimeoutSec`, `keep`).
- Kill switch: **`MCP_HTTP=0`** disables the MCP HTTP endpoint.
