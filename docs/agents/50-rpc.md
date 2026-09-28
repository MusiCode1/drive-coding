---
id: rpc
title: Agent session RPC — POST /api/agents/:id/rpc
summary: JSON-RPC-style methods on a live agent session (prompt, cancel, session management, and drive-coding extensions).
read_when:
  - You need to send a prompt or cancel a turn on an agent that is already connected
  - You are integrating with the FE-style RPC surface instead of MCP session_send
  - You need the canonical list of RPC method names and what each one expects
tags: [rpc, session]
surface: [http]
stability: transitional
routes: [POST /api/agents/:id/rpc]
docs_version: 1.0.0
updated: 2026-09-28
---

# Agent session RPC

`POST /api/agents/:id/rpc` accepts a JSON body `{ "method": "<name>", "params": { … }, "waitMs"?: number }`.
The agent must exist and have an active session host; otherwise the backend returns `404` or `503`.

Method names below are the **canonical** strings from `RPC_METHODS` in `@drive-coding/core`.
Legacy aliases (for example `prompt` instead of `session/prompt`) may still be accepted during migration — prefer the canonical name in new integrations.

## Methods

| Method | Role |
|--------|------|
| `session/prompt` | Send user content to the ACP session (`params.sessionId`, `params.content`). |
| `session/cancel` | Cancel the in-flight turn for `params.sessionId`. |
| `session/set_mode` | Switch session mode (`params.modeId`). |
| `session/set_config_option` | Set a config option (`params.configId`, `params.value`). |
| `session/load` | Load an existing ACP session (`params.sessionId`, optional `params.cwd`). |
| `session/new` | Start a new ACP session (optional `params.cwd`). |
| `session/list` | List sessions exposed by the CLI (blocking JSON result). |
| `session/delete` | Delete a session by `params.sessionId`. |
| `_drive/ext` | Extension dispatch (`params.method`, optional `params.params`). |
| `_drive/set_session_model` | Legacy model override (`params.model`) — prefer config options when available. |

## `waitMs`

Six methods (`session/prompt`, `session/cancel`, `session/set_mode`, `session/set_config_option`, `_drive/ext`, `_drive/set_session_model`) accept optional top-level `waitMs` (1–60000).
When set, the HTTP handler waits for the operation to finish and returns a result object instead of `202`.

Management methods (`session/list`, `session/load`, `session/new`, `session/delete`) ignore `waitMs` and always return their result synchronously.

## OpenAPI

Request and response shapes for the HTTP surface (including partial schema coverage for `params`) live in `docs/agents/openapi.json` alongside the other routes.
