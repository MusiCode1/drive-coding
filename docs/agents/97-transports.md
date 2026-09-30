---
id: transports
title: Transports — HTTP, SSE, MCP, WebSocket
summary: When to use REST, agent events SSE, Streamable HTTP MCP, or browser WebSockets.
read_when:
  - You need server push for turn events but HTTP alone is stateless
  - You integrate via MCP Streamable HTTP at /api/mcp
  - You wonder why /ws/agent is not in the OpenAPI spec
tags: [transports]
surface: [http, mcp]
stability: stable
routes:
  - GET /api/mcp
  - POST /api/mcp
  - DELETE /api/mcp
  - POST /api/agents/:id/subscribe
  - DELETE /api/agents/:id/connection
docs_version: 1.2.0
updated: 2026-09-28
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
| `204` | Subscribed | `agent-events-http.ts:33` |

## MCP Streamable HTTP — `/api/mcp`

One registration handles **`POST`**, **`GET`**, and **`DELETE`** on the same path (`http-mcp.ts:346`).

- Stateless transport per request (`http-mcp.ts:358-370`).
- Optional caller identity via **`X-Drive-Coding-Agent`** (`http-mcp.ts:347-356`).
- **`MCP_HTTP=0`** — route not mounted → **`404`** (`http-mcp.test.ts:203-206`, `http-mcp.ts:341-344`).

Prefer MCP for **`session_*`** tools when your CLI already speaks MCP; prefer HTTP RPC when mirroring the FE (`50-rpc`).

## WebSocket (browser FE)

**`/ws/agent/:id`** and **`/ws/echo`** exist for the drive-first PWA (`boot/ws.ts:96`, `boot/ws.ts:103`). They are **intentionally omitted** from `openapi.json` and from `routes:` here — coding agents on the same host should use HTTP/MCP, not impersonate the browser WS client.

## DELETE /api/agents/:id/connection

Drops one viewer connection row; **does not** kill the agent or session host (`connection.ts:4-6`, `connection.ts:21-34`).

| Status | When | Anchor |
|--------|------|--------|
| `404` | No connection registry for agent | `connection.ts:25` |
| `204` | Removed (or no-op when connection id absent) | `connection.ts:34` |
