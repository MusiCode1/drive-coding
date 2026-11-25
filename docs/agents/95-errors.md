---
id: errors
title: Errors — HTTP status codes and what they mean
summary: How to interpret drive-coding HTTP and MCP failures without guessing whether work started or an agent still exists.
read_when:
  - The backend answered 202 and you cannot tell whether the work started
  - You got a 404 and cannot tell whether the agent is gone or just not connected
  - A request returned 200 with timedOut true and you must decide what to do next
tags: [errors, rpc]
surface: [http, mcp]
stability: stable
docs_version: 1.14.0
updated: 2026-11-25
---

# Errors

Use status code **and body shape** — many endpoints share **404** with different meanings.

## RPC `POST /api/agents/:id/rpc`

| Status | When | What to do |
|---|---|---|
| **202** | Prompt/cancel/config dispatched, **`waitMs` 0 or omitted** | Turn may be running; read **`turnState`** via state/history/SSE. Async failures land in **`lastTurnError`**, not always in HTTP body. |
| **200** + `timedOut: true` | **`waitMs`** elapsed, turn still running | Do **not** assume failure; poll history/SSE or retry with higher wait. |
| **200** + `ok: false`, `timedOut: false` | Turn failed synchronously in wait path | Read **`error.message` / `code`**, **`messagesSince`** if present. |
| **200** + `ok: true` on **cancel** with wait | Cancel **sent**, not guaranteed executed | Confirm via state; cancel promise may swallow errors. |
| **400** | Bad JSON, invalid params, invalid **`waitMs`**: a non-integer, or an integer **outside 1..60000** (**no clamp**) — note **`0` / absent** is the **202** fire-and-forget path, not an error | Fix request; do not retry identical payload. |
| **401** | Agent authentication required (`kind: "auth_required"`) | Read `authMethods` and authenticate before retrying. |
| **404** | Agent connection missing or dead | The agent record may still exist in the registry. |
| **409** + `code: "session_busy"` | Any `session/load` while a turn is active | Wait for the turn to reach `idle`, or stop it, before loading. |
| **502** | Upstream ACP/session RPC failed on blocking management calls | Inspect `error` / `code` body. |

## SSE `GET /api/agents/:id/events`

| Status | Meaning |
|---|---|
| **401** | Agent authentication required, with `authMethods` |
| **404** | Agent connection missing or dead |
| **409** | Stale **`?epoch=`** — reconnect with current epoch or fall back to history |

The first viewer after the group becomes empty starts a new epoch. Additional
SSE and WebSocket viewers share it. A stale epoch gets `409` on SSE or
`4409` on [the session WebSocket](97-transports.md). The **`taken-over`** stream
event remains reserved for protocol compatibility. This server never emits it.

## History / state

| Route | 404 | 400 |
|---|---|---|
| **GET …/history** | No host — `{ error: "Agent connection not found" }` | Bad **`fromMessage`**; unknown **`before`** seq; empty **`before=`** or **`tail=`**; **`maxBytes`** without `tail`/`before` or invalid; `tail` + `before` / `fromMessage` conflicts |
| **GET …/state** | Same 404 body | — |
| **GET …/events?snapshot=** | No host — **404 after** a valid `snapshot` passes parsing | Invalid `snapshot` (not `full` or `meta`); empty/missing ⇒ `full` |

**404 on host routes ≠ "agent UUID unknown"** — check **`GET /api/agents/:id`** for registry truth.

## Agent CRUD

| Call | Typical errors |
|---|---|
| **POST /api/agents** | **400** invalid body; **500** spawn failure message |
| **DELETE /api/agents/:id** | **404** unknown id |
| **PATCH /api/agents/:id** | **400** schema/undeclared keys; **409** connection tuple conflicts |

## MCP scope and limits

- Scoped **write** to another agent's subtree → permission prompt to your user; refusal →
  **`scope-denied`** (see server instructions).
- **session_close** when **`turnState !== idle`** without **`force: true`** → tool error; use
  force only when you accept stopping mid-turn.
- **`MCP_HTTP=0`** → MCP endpoint disabled (connection failure at HTTP layer).

Canonical tools may return `isError: true` with a code in result-level `_meta["drive-coding/errorCode"]`. The legacy tools retain their error text.

| Code | When |
|---|---|
| `agent_not_found` | A target lookup fails for state, send or subscribe, or the caller record disappears during field deletion. |
| `agent_host_unavailable` | State has a record without a host, or open/send cannot acquire a host. |
| `no_active_acp_session` | Send reaches a host without an active ACP session ID. |

Validation, scope denial and provider errors keep their existing error shapes. Discover availability through `tools/list`. A send timeout can return `{ running: true }` while the original turn continues.

## Decision cheatsheet

```
202 on RPC prompt     → work may have started; verify turnState + lastTurnError
404 on /history       → no session host; agent may still exist
401 on /events or RPC → authenticate using authMethods before retrying
200 timedOut:true     → turn still running; keep polling
400 waitMs            → integer 1..60000 only (0/omit → 202, not 400)
```

For connect/discovery failures (wrong base), see **`10-connect`**.
