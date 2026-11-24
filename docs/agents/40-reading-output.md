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
mcp_tools: [session_send, session_state]
docs_version: 1.11.2
updated: 2026-11-24
---

# Reading output

After **session_send** with **`noWait: true`** (or an HTTP RPC prompt with **`waitMs`**
absent/zero), the turn keeps running. You need a **pull** or **stream** path to read text,
errors, and **`turnState`**.

## session_state / session_send results (MCP)

**session_state** returns **`host.state`** snapshot fields you request:

- Default: **`turnState`**, modes, **`configOptions`**, errors — **not** full message logs.
- **`fields: ["*"]`** for a large snapshot when you accept the payload size.

**session_send** on completion returns **`text`**, **`stopReason`**, **`messagesSince`**, and
**`lastTurnError`** when the turn ends. On **`noWait`** or timeout → **`{ running: true }`**;
keep polling.

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
```

- Same **`updates`** shape as SSE frame-zero (`snapshotPayload`) — single source of truth.
- **404** if no host (read path does not create a host).
- **`fromMessage`** — cursor from an `m_<seq>` id or ACP **`messageId`**. Unknown id → **400**
  `{ error: "unknown fromMessage", fromMessage }` (not silent full history).
- Empty / missing `fromMessage` → full snapshot.

Prefer **history** when you cannot keep SSE open (scripts, reconnect without epoch handling).

## SSE live stream

```http
GET /api/agents/:id/events
```

Protocol (event names):

| Event | Role |
|---|---|
| `snapshot` | Initial coalesced state + `version`, `epoch`, `updates[]` |
| `update` | Live JSON-RPC batch of session updates |
| `stream-alive` | Keepalive carrying `_drive/streamAlive` |
| `taken-over` | The raw WebSocket took ownership; stop reconnecting |

Status codes:

- **404** — connection not found / not HTTP-owned / dead host path.
- **503** — transient **`evict-timeout`** (stuck tab) — retry; not always "agent gone".
- **409** — `?epoch=` lower than current epoch (stale reconnect) **before** attach.

Design: subscribe after snapshot so replay excludes patches already in frame-zero.

In snapshots and live updates, `current_mode_update` may include
`_meta["_drive/availableModes"]`, the non-empty list of available modes reported
by the CLI. Each entry has an `id` and `name` and may have a `description`.
An update without this field leaves the viewer's existing list intact.

SSE and [WebSocket session viewers](97-transports.md) can watch concurrently.
The first viewer after the group becomes empty starts a new epoch. Additional
viewers share that epoch.

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

With **`waitMs` 1..60000** on prompt-like methods:

- **200** success: `{ version, ok: true, timedOut: false, messagesSince?, result? }`
- **200** turn failure: `{ ok: false, timedOut: false, error, messagesSince? }`
- **200** timeout: `{ ok: false, timedOut: true }` — **turn continues**; use SSE/history.

Invalid **`waitMs`** (non-integer, negative, **> 60000**) → **400** — not clamped.

**Cancel** with wait: **`ok: true` means "sent"**, not "executed".

Blocking session management RPCs (`session/list`, `session/load`, …) ignore `waitMs` and return method-specific statuses (**200**, **400**, or **502**).
During an active turn, any **`session/load`** returns **409** with `code: "session_busy"`. The turn continues.

See **`95-errors`** for 404 vs 503 on RPC.

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
