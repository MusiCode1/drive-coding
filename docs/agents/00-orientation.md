---
id: orientation
title: Orientation — what drive-coding is and which channel to use
summary: Start here; explains what an agent can do here and whether to reach the backend over HTTP, MCP or the CLI.
read_when:
  - You have just been handed a drive-coding backend and do not know what it offers
  - You must choose between the HTTP API, the MCP server and the CLI
tags: [orientation]
surface: [http, mcp, cli]
stability: stable
docs_version: 1.1.0
updated: 2026-09-28
---

# Orientation

## What drive-coding is

drive-coding is a drive-first, voice-capable UI for **ACP-compatible coding agents**
(Cursor, Claude Code, Codex, OpenCode, and others).

- The **backend** hosts your ACP child process, proxies voice APIs, and serves local
  files to the browser through a file proxy.
- The **frontend** is the user's chat surface (phone or desktop). They may be driving
  and listening, or reading the screen.
- You are not talking to a bare terminal: the user sees or hears your replies through
  this product. Prefer outputs the UI can render well (see `45-render-contract`).

Over MCP, the server describes itself as: spawn and control ACP coding agents on this
backend — typical flow **session_open → session_send → session_close**.

## Three ways to reach the same backend

All three talk to the **same** live backend process. Pick by what you already have and
whether you need push or spawn helpers.

| Channel | Best when | What you get |
|---|---|---|
| **HTTP** (`/api/…`) | You control fetch/curl, build a custom client, or drive the session host (history, SSE, RPC) directly | Full REST surface: health, agents, session host routes |
| **MCP** (`POST/GET/DELETE {base}/api/mcp`, Streamable HTTP) | Your tool runner already speaks MCP and you want **session_list / session_open / session_send / session_state / session_close** without writing HTTP | Stateless request/response — **no server→client push**; poll `session_state` or wait on `session_send` |
| **CLI** (`drive-coding agent …`) | A human or script on the same machine wants thin commands over HTTP | Same operations as HTTP, with instance discovery rules built in |

### How to choose in practice

- **Need to spawn and steer other agents from inside a session?** Use **MCP** (or HTTP
  equivalents). The session-bus tools are documented in `20-session-lifecycle` and
  `30-child-config`.
- **Already inside a spawned child with MCP injected?** Check `session_list` before
  opening duplicates; reuse `DRIVE_CODING_BASE` / `X-Drive-Coding-Agent` from the
  injection (see `10-connect`).
- **Only need read/write on one agent's transcript and turns?** **HTTP** session-host
  routes (`/history`, `/events`, `/rpc`) are enough — see `40-reading-output`.
- **Operator on the shell, no MCP client?** **`drive-coding agent`** — but never guess
  the port; follow discovery in `10-connect`.

### MCP limits (stateless)

The MCP surface is **stateless HTTP**: there are no live push notifications from server
to client. After `session_send` with `noWait`, poll `session_state` or use HTTP SSE on
`/api/agents/:id/events` if you hold a stream. The backend may disable MCP entirely with
`MCP_HTTP=0`.

### Security posture (orientation only)

There is **no authentication layer** on these APIs in the default deployment — treat
network access as trust-boundary. Scoped writes for spawned agents are a **guard rail
against accidents**, not a security boundary (details in stage-3 scope docs).

## Where to read next

| Goal | Document |
|---|---|
| Find base URL, port, env vars | `10-connect` |
| Open, send, close, ownership | `20-session-lifecycle` |
| Model / permission / `sets` | `30-child-config` |
| History, SSE, RPC replies | `40-reading-output` |
| Images, files, mermaid | `45-render-contract` |
| Status codes and errors | `95-errors` |
