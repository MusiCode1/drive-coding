---
id: transports
title: Transports — HTTP, SSE, MCP, WebSocket
summary: When to use REST, agent events SSE, Streamable HTTP MCP, or browser WebSockets.
read_when:
  - You need server push for turn events but HTTP alone is stateless
  - You integrate via MCP Streamable HTTP at /api/mcp
  - You want to receive session events or send RPC calls over WebSocket
tags: [transports]
surface: [http, mcp]
stability: stable
routes:
  - GET /api/mcp
  - POST /api/mcp
  - DELETE /api/mcp
  - POST /api/agents/:id/subscribe
  - DELETE /api/agents/:id/connection
mcp_tools:
  - session_subscribe
docs_version: 1.11.1
updated: 2026-11-24
---

# Transports

expanded from `packages/backend/src/prompts/surface/capabilities.ts`; that file is the Tier-2 summary.

## Stateless HTTP

Plain request/response is the default agent surface. There is **no server→client push** on ordinary HTTP (`prompts/surface/capabilities.ts` — see Limits in the shrunk Tier-2 block). Poll **`session_state`**, use **`session_send`** wait semantics, or add a push channel below.

## SSE — turn and session events

**`GET /api/agents/:id/events`** is documented in `40-reading-output` (Server-Sent Events). Do not duplicate that stream format here.

## HTTP subscribe (agent events bus)

**`POST /api/agents/:id/subscribe`** registers another agent id to receive event notifications (`agent-events-http.ts:15-33`).

| Status | When | Anchor |
|--------|------|--------|
| `404` | Unknown target agent | `agent-events-http.ts:18` |
| `400` | Invalid JSON or body | `agent-events-http.ts:24`, `agent-events-http.ts:28` |
| `403` | Subscriber scope denied | `agent-events-http.ts` |
| `204` | Subscribed | `agent-events-http.ts` |

### The same bus over MCP — `session_subscribe`

`session_subscribe` `{ agent, subscriber?, includeLastAssistantText? }` registers `subscriber`
(default: your `X-Drive-Coding-Agent`) for the target `agent`'s events and returns
`{ ok: true, agent, subscriber }`. An unknown target, or no subscriber and no header, is an
error. Scoped writes are checked against the effective subscriber as described in
`60-identity-and-scopes`. Repeating the same options leaves the subscription unchanged.
New options update it.

Events arrive in the subscriber's own session as a system envelope (`45-render-contract`):
`<event-kind>turn-ended</event-kind>` when a turn ends — not that the task is done — and
`<event-kind>stall-suspected</event-kind>` when a turn looks stuck, a suspicion only. With
`includeLastAssistantText`, turn-ended carries a truncated preview of the agent's last reply.

## MCP Streamable HTTP — `/api/mcp`

One registration handles **`POST`**, **`GET`**, and **`DELETE`** on the same path (`http-mcp.ts:346`).

- Stateless transport per request (`http-mcp.ts:358-370`).
- Optional caller identity via **`X-Drive-Coding-Agent`** (`http-mcp.ts:347-356`).
- **`MCP_HTTP=0`** — route not mounted → **`404`** (`http-mcp.test.ts:203-206`, `http-mcp.ts:341-344`).

Prefer MCP for **`session_*`** tools when your CLI already speaks MCP; prefer HTTP RPC when mirroring the FE (`50-rpc`).

## WebSocket — session channel

Upgrade **`GET /ws/session/:id?connectionId=…&epoch=…`** to open a viewer. Both
query parameters are optional. Provide a unique `connectionId` and reuse it
for that viewer's HTTP presence and detach requests.

- The server sends one JSON object `{event, id?, data}` per frame. The event
  names and the contents of the `data` string match the SSE stream in
  [Reading output](40-reading-output.md).
- Send RPC and reply as JSON-RPC requests
  `{jsonrpc:"2.0", id, method, params}`. Use a numeric `id` and method
  `_drive/rpc` or `_drive/reply`. Put the full body of the corresponding
  HTTP POST in `params`. The response is
  `{jsonrpc:"2.0", id, result:{status, body}}`. With a scoped caller, pass
  the scope header in the upgrade request.
- **`POST /api/agents/:id/presence`** renews the viewer row. Send
  `Acp-Connection-Id` with the viewer's ID.
- Clients must send `$/ping` after opening the socket and at intervals
  shorter than 60 seconds. Each ping requests a `$/pong` and renews socket
  liveness only. The server checks every 20 seconds and terminates sockets
  whose last ping is more than 60 seconds old. The client sees `1006` even if
  it was still receiving session frames.
- Send `$/detach` to release the viewer. Ping, pong, and detach are JSON-RPC
  notifications.

SSE and WebSocket viewers can share one session and viewing epoch. The first
viewer after the group becomes empty starts a new epoch. If a supplied
`epoch` is older than the server's epoch, the connection closes with `4409`
before opening the session host.

| Close code | Meaning |
|---|---|
| `1000` | Viewer released, expired, or stream ended |
| `1006` | Abnormal closure, including server termination after missed pings |
| `4401` | Agent authentication is required |
| `4404` | Agent connection is missing |
| `4409` | Stale epoch or takeover by the raw WebSocket |
| `4500` | Internal failure |
| `4503` | Temporary failure to evict the previous owner |

An opening failure sends an `error` frame with the HTTP error body encoded
in `data` before closing. A takeover of an active stream sends
`taken-over` before closing. For opening failures the close code is
`4000 + HTTP status`.

### Legacy browser sockets

**`/ws/agent/:id`** is the raw ACP transport and is scheduled for removal.
**`/ws/echo`** carries browser configuration notifications.

## DELETE /api/agents/:id/connection

Releases the selected viewer connection and ends its SSE or WebSocket stream. The
agent, session host, and other viewers stay active (`boot/ws.ts`, `connection.ts`).

| Status | When | Anchor |
|--------|------|--------|
| `404` | No connection registry for agent | `connection.ts:25` |
| `403` | Viewer detach denied by scope policy | `boot/ws.ts` |
| `204` | Viewer released or connection id absent or unknown | `connection.ts` |
