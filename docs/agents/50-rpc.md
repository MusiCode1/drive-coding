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
docs_version: 1.2.0
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

## `waitMs` and blocking

Six methods honor optional top-level `waitMs` (1–60000) on the HTTP handler (`session-host/http/rpc.ts:67-74`):

- `session/prompt` · `session/cancel` · `session/set_mode` · `session/set_config_option` · `_drive/ext` · `_drive/set_session_model`

Without `waitMs` (or `0`), those six return **`202`** with `{ version }` only (`rpc.ts:425`).
With valid `waitMs`, the handler waits and returns **`200`** result bodies (or **`200`** `{ ok: false, timedOut: true }` on timeout — `rpc.ts:211-212`, `rpc.ts:137-139`).
Invalid `waitMs` on those six → **`400`** `{ error: "invalid waitMs" }` (`rpc.ts:189-190`).

Management methods (`session/list`, `session/load`, `session/new`, `session/delete`) **ignore** `waitMs` and always return their own **`200`** / **`400`** / **`502`** bodies (`rpc.ts:17-24`, `rpc.ts:303-415`).

## HTTP status codes

| Status | When | Anchor |
|--------|------|--------|
| `404` | Host missing (final reasons) | `rpc.ts:168-169` |
| `503` | Host missing, reason `evict-timeout` | `rpc.ts:168-169` |
| `400` | Invalid JSON | `rpc.ts:177-178` |
| `400` | Unknown method | `rpc.ts:421` |
| `400` | ArkType param errors (`p.summary`) | `rpc.ts:198`, `rpc.ts:236`, etc. |
| `400` | `load`/`new` without cwd | `rpc.ts:338`, `rpc.ts:375` |
| `202` | Fire-and-forget success for the six wait-capable methods | `rpc.ts:425` |
| `200` | Blocking wait results, management results, or `-32601` degradations | `rpc.ts:211-231`, `rpc.ts:303-415` |
| `502` | Upstream/session errors on management calls | `rpc.ts:328-331`, `rpc.ts:365-367`, etc. |

Scoped writes may deny before dispatch — see `60-identity-and-scopes`.

## Parameter validation (selected)

| Method | Invalid params | Response |
|--------|----------------|----------|
| `session/prompt` | ArkType `PromptParams` | `400` + `error` summary (`rpc.ts:197-198`) |
| `session/cancel` | ArkType `CancelParams` | `400` (`rpc.ts:235-236`) |
| `session/load` | ArkType / missing cwd | `400` (`rpc.ts:335-338`) |
| `session/new` | ArkType / missing cwd | `400` (`rpc.ts:372-375`) |
| `session/delete` | ArkType | `400` (`rpc.ts:402-403`) |
| `session/list` | (none) | errors → `502` or empty list on `-32601` (`rpc.ts:318-331`) |
| `session/delete` | unsupported CLI | `200` `{ ok: false, unsupported: true }` on `-32601` (`rpc.ts:408-409`) |

## OpenAPI

Request and response shapes for the HTTP surface (including partial schema coverage for `params`) live in `docs/agents/openapi.json` alongside the other routes.
