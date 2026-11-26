---
id: reading-output
title: Reading output — history, SSE, state, and RPC waits
summary: How to read agent messages, turn progress, tool output, and session modes through state, history, and SSE.
read_when:
  - You sent a prompt with noWait and now need the agent's reply
  - You must follow a long turn without holding a stream open
  - You have a message id and want only what came after it
  - You need to reconstruct a tool's output from live updates or a snapshot
tags: [output, session]
surface: [http, mcp]
stability: stable
routes:
  - GET /api/agents/:id/history
  - GET /api/agents/:id/events
  - GET /api/agents/:id/state
  - POST /api/agents/:id/rpc
mcp_tools: [session_send, session_state, agent_send, agent_state]
docs_version: 1.17.1
updated: 2026-11-26
---

# Reading output

After **session_send** with **`noWait: true`** (or an HTTP RPC prompt with **`waitMs`**
absent/zero), the turn keeps running. You need a **pull** or **stream** path to read text,
errors, and **`turnState`**.

## session_state / session_send results (MCP)

The MCP catalog also lists `agent_state` and `agent_send`, whose target input is `agentId`. The examples use `session_state` and `session_send` with `agent`.

**session_state** returns **`host.state`** snapshot fields you request:

- Default: **`turnState`**, modes, **`configOptions`**, errors — **not** full message logs.
- **`fields: ["*"]`** for a large snapshot when you accept the payload size.

**session_send** returns `{ text, stopReason, messagesSince, lastTurnError }` for a completed wait.
For an ACP v1 result, `stopReason` is exactly `end_turn`, `cancelled`, `refusal`,
`max_tokens`, or `max_turn_requests`. The first two have `lastTurnError: null`.
Refusal and limits use `lastTurnError: { message, at }` with the reason as the message.
A rejected request uses the normalized rejection message in `stopReason` and `lastTurnError.message`.

With `noWait: true`, or when the wait reaches `timeoutSec` (default 1800 seconds),
the response is `{ running: true }`. Follow the turn through state or the session stream.

## One-shot HTTP snapshot

```http
GET /api/agents/:id/state
```

- **200** — JSON **`SessionState`** as held by the session host (debug / health style).
- **404** — `{ error: "Agent connection not found" }` — no host for this id (not the same as
  agent record missing from registry).

Does **not** extend HTTP ownership TTL (unlike **`POST …/presence`**).

## History pull (no SSE)

```http
GET /api/agents/:id/history
GET /api/agents/:id/history?fromMessage=<messageId>
GET /api/agents/:id/history?tail=1&maxBytes=<n>
GET /api/agents/:id/history?before=<seq>&maxBytes=<n>
```

- Same **`updates`** shape as SSE frame-zero (`snapshotPayload`) — single source of truth.
- **404** if no host (read path does not create a host).
- **`fromMessage`** — cursor from an `m_<seq>` id or ACP **`messageId`**. Unknown id → **400**
  `{ error: "unknown fromMessage", fromMessage }` (not silent full history).
- Empty / missing `fromMessage` → full snapshot.

**Tail and earlier pages (slice 1):**

| Query | Payload |
|---|---|
| `tail=1&maxBytes=` | Latest message page plus session tail and `carried` (anchored inside the page stay in place; others are emitted before the page). Response includes `page: { firstSeq, lastSeq, hasMore }`. |
| `before=<seq>&maxBytes=` | Messages strictly before that seq only — no session tail, no `carried`. `before=0` is an empty page. Unknown seq → **400** `{ error: "unknown before", before }`. |
| `maxBytes` alone, invalid `tail`, `before=` empty, conflicting params | **400** (see `95-errors`). |

`maxBytes` is clamped to a server ceiling (default applied when absent is **not** allowed with `tail` or `before`).

Prefer **history** when you cannot keep SSE open (scripts, reconnect without epoch handling).

## SSE live stream

```http
GET /api/agents/:id/events
GET /api/agents/:id/events?snapshot=full
GET /api/agents/:id/events?snapshot=meta
```

- **`snapshot=meta`** — opening frame omits message history and includes `historyOmitted: { messageCount }`; updates after `session/load` prepend `_drive/reset` plus session tail only (no messages in that frame). **Replay after a load still arrives as live per-message updates** on the same stream — clients that want an empty transcript until they fetch pages must hold a window or reload (slice 1 FE: `HistorySync`). Same contract on the [session WebSocket](97-transports.md) via `?snapshot=meta`. Invalid values → **400**; WebSocket closes with **4400**. On `/events`, invalid `snapshot` is checked before **404** (unknown agent still gets **400**); empty `snapshot=` is treated as `full`.
- Missing or empty `snapshot` → **full** (backward compatible).

Protocol (event names):

| Event | Role |
|---|---|
| `snapshot` | Initial coalesced state + `version`, `epoch`, `updates[]` |
| `update` | Live JSON-RPC batch of session updates |
| `stream-alive` | Keepalive carrying `_drive/streamAlive` |
| `taken-over` | Reserved for protocol compatibility. This server never emits it. |

Status codes:

- **401** — the agent requires authentication (`kind: "auth_required"`, with `authMethods`).
- **404** — the connection is missing or dead.
- **409** — `?epoch=` lower than current epoch (stale reconnect) **before** attach.

Design: subscribe after snapshot so replay excludes patches already in frame-zero.

For a completed ACP v1 turn, the live `state_update` with `state: "idle"` and
the next snapshot's idle update carry the same `stopReason`. Use
`_meta["_drive/at"]` on that update for the recorded error timestamp when present.
The live `_drive/agent_event` notification for `turn-ended` carries the agent ID
and the same reason.

In snapshots and live updates, `current_mode_update` may include
`_meta["_drive/availableModes"]`, the non-empty list of available modes reported
by the CLI. Each entry has an `id` and `name` and may have a `description`.
An update without this field leaves the viewer's existing list intact.

SSE and [WebSocket session viewers](97-transports.md) can watch concurrently.
The first viewer after the group becomes empty starts a new epoch. Additional
viewers share that epoch. A stale epoch also closes a WebSocket with **4409**.

## Canonical tool output

The session host can normalize output from a CLI
with configured tool output rules. In `GET /state`, a tool message can carry
`toolCall.output` with optional `text`, `stdout`, `stderr`, `error`, `exitCode`,
`isError`, and `truncated` fields. The host uses `toolCall.outputRank` internally
to track which source produced each field.

On live SSE and WebSocket updates, the corresponding change is in
`_meta["_drive/toolOutput"]`. Apply its optional `set` first and then concatenate
the strings in its optional `append` onto their respective fields. Start an
absent field at the empty string. Each text field keeps its last 65,536
UTF-16 code units. An oversized `set` arrives capped, while an `append` carries
the received chunk. Preserve `truncated: true` once the cap is exceeded or the
delta specifies it.

In a session snapshot, `GET /history`, and the update that creates a tool, the
same metadata key uses `set` for the full canonical values and includes
`truncated: true` when applicable. Source ranks stay in server state. The original
`rawOutput` remains available. The host resolves the configuration at
creation, so changes apply to new hosts.

## RPC with wait (`POST /api/agents/:id/rpc`)

Fire-and-forget (**202** `{ version }`) for prompt/cancel/config when **`waitMs`** is 0 or omitted.

With **`waitMs` 1..60000** on `session/prompt`, HTTP **200** carries one of these bodies.

- ACP v1 completion returns `{ version, ok: true, timedOut: false, messagesSince, stopReason }`.
  `ok: true` means an ACP result arrived, including results with a refusal or limit.
- Request rejection returns `{ version, ok: false, timedOut: false, error, messagesSince }`.
  `error` includes `message` and carries `code` when available.
- Wait timeout returns `{ version, ok: false, timedOut: true }`. The turn continues.
  Follow its result through SSE or history.

Invalid **`waitMs`** (non-integer, negative, **> 60000**) → **400** — not clamped.

**Cancel** with wait: **`ok: true` means "sent"**, not "executed".

Blocking session management RPCs (`session/list`, `session/load`, …) ignore `waitMs` and return method-specific statuses (**200**, **400**, or **502**).
During an active turn, any **`session/load`** returns **409** with `code: "session_busy"`. The turn continues.

See **`95-errors`** for RPC error responses.

## Choosing a path

| Situation | Prefer |
|---|---|
| MCP client, moderate polling | **session_state** + occasional **session_send** |
| Script, one-shot read | **GET /history** |
| FE or long-lived follower | **GET /events** SSE |
| Need reply inline with timeout cap | **RPC prompt** with **`waitMs`** |

## Message cursor tips

Use **`messagesSince`** from a completed **session_send** or history ids to avoid re-processing
old bubbles. **`lastTurnError`** in state/send results surfaces async turn failures when HTTP
returned **202** for the initial dispatch.
