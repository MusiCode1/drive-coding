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
ext_methods:
  - _drive/setThinkingTokens
  - _drive/getQuota
  - _drive/voice/start
  - _drive/voice/stop
  - _drive/voice/listVoices
  - _drive/voice/speak
docs_version: 1.10.4
updated: 2026-11-20
---

# Agent session RPC

`POST /api/agents/:id/rpc` accepts a JSON body `{ "method": "<name>", "params": { … }, "waitMs"?: number }`.
The agent must exist and have an active session host; otherwise the backend returns `404` or `503`.

Method names below are the **canonical** strings from `RPC_METHODS` in `@drive-coding/core`.
Legacy aliases (for example `prompt` instead of `session/prompt`) may still be accepted during migration — prefer the canonical name in new integrations.

## Methods

| Method | Role |
|--------|------|
| `session/prompt` | Send user content to the ACP session (`params.sessionId`, `params.content`). When the HTTP caller identifies as another agent (`X-Drive-Coding-Agent`), text is wrapped in **`drive-coding-msg` v1** with that caller as **`sender`**; anonymous callers receive unwrapped content. |
| `session/cancel` | Cancel the in-flight turn for `params.sessionId`. |
| `session/set_mode` | Switch session mode (`params.modeId`). |
| `session/set_config_option` | Set a config option (`params.configId`, `params.value`). |
| `session/load` | Load an existing ACP session (`params.sessionId`, optional `params.cwd`). |
| `session/new` | Start a new ACP session (optional `params.cwd`). |
| `session/list` | List sessions exposed by the CLI (blocking JSON result). |
| `session/delete` | Delete a session by `params.sessionId`. |
| `_drive/ext` | Extension dispatch (`params.method`, optional `params.params`). |
| `_drive/set_session_model` | Legacy model override (`params.model`) — prefer config options when available. |

## Extensions (`_drive/ext`)

`_drive/ext` carries drive-coding's own methods to the agent's provider:
`{ "method": "_drive/ext", "params": { "method": "<extension>", "params": { … } }, "waitMs": … }`.
The contract of each one — params and result — is one registry, `extMethods` in
`packages/provider/src/extensions/schema.ts`. The backend passes `params` through unchanged,
so send exactly that shape. Pass `waitMs` to get the answer: `200`
`{ ok: true, result }`, or `{ ok: false, error }` when the provider failed or rejected it.
Without `waitMs` the call is fire-and-forget (`202`).

Each extension is gated by a flag in the session's `capabilities` (in `session_state` and
`GET /api/agents/:id/state`). Call it only when the flag is `true` — a provider without it does
not implement the method.

| Extension | Capability | Params → result | What it does |
|---|---|---|---|
| `_drive/setThinkingTokens` | `thinkingTokens` | `{ sessionId, n: number \| null }` → `{ ok: true }` | Caps the model's thinking budget; `null` removes the cap. |
| `_drive/getQuota` | `usage` | `{ sessionId }` → `{ snapshot }` | The account's usage windows. `snapshot` is `null` when no limit is visible yet — still a supported answer. Otherwise `{ provider, plan?, windows[] }`, each window `{ id, period, consumption, resetsAtMs }`: `period` is `{ kind: "rolling", durationSeconds }` or `{ kind: "calendar", unit }`; `consumption` is `{ kind: "percentage", usedPct }` or `{ kind: "absolute", used, limit, unit }`. |
| `_drive/voice/start` | `voice` | `{ sessionId, sdp, instructions?, voice? }` → `{ sdp }` | Starts the agent's own realtime voice for the session (below). |
| `_drive/voice/stop` | `voice` | `{ sessionId }` → `{}` | Ends it. |
| `_drive/voice/listVoices` | `voice` | `{ sessionId }` → `{ voices, default, details? }` | Voice ids, the one used when none is chosen, and per-voice `{ description?, accent?, previewUrl? }` (`previewUrl` is a short public sample clip). |
| `_drive/voice/speak` | `voice` | `{ sessionId, text }` → `{}` | Makes the voice say `text` now (e.g. that an approval waits on screen). |

### The agent's own voice (`_drive/voice/*`)

Some providers have a realtime voice of their own; today that is **Codex** (`voice: true`),
through its app-server realtime API (GPT-Live). It needs Codex CLI **0.167 or newer** and
runs on the ChatGPT account Codex is signed in with — no API key.

The caller is the WebRTC peer: it captures the microphone, plays the voice, and opens an
`oai-events` data channel; drive-coding only relays the SDP. Create the offer, send it as
`sdp` to `_drive/voice/start`, and apply the returned `sdp` as the answer. `instructions`
steer the voice; `voice` is one of `listVoices` (omit for the default).

The voice talks with the user and hands work to the agent. Both show up in the chat as
messages marked `_meta["_drive/voice"]` — see `45-render-contract`. Between the agent's turns
the session reports `idle`, so a voice reply does not look like a running turn.

## `waitMs` and blocking

Six methods honor optional top-level `waitMs` (1–60000) on the HTTP handler (`session-host/http/rpc.ts:67-74`):

- `session/prompt` · `session/cancel` · `session/set_mode` · `session/set_config_option` · `_drive/ext` · `_drive/set_session_model`

Without `waitMs` (or `0`), those six return **`202`** with `{ version }` only (`rpc.ts:425`).
With valid `waitMs`, the handler waits and returns **`200`** result bodies (or **`200`** `{ ok: false, timedOut: true }` on timeout — `rpc.ts:211-212`, `rpc.ts:137-139`).
Invalid `waitMs` on those six → **`400`** `{ error: "invalid waitMs" }` (`rpc.ts:189-190`).

Management methods (`session/list`, `session/load`, `session/new`, `session/delete`) **ignore** `waitMs` and return method-specific status codes. Any **`session/load`** while a turn is active returns **`409`** with `{ error, code: "session_busy" }`. The active turn continues. **`session/new`** is still allowed during a turn.

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
| `409` | Any `session/load` while a turn is active | `rpc-session-mgmt.ts` |
| `502` | Upstream/session errors on management calls | `rpc.ts:328-331`, `rpc.ts:365-367`, etc. |

Scoped writes may deny before dispatch — see `60-identity-and-scopes`.

## Envelope on `session/prompt`

Identified callers: **string** `params.content` becomes one `<drive-coding-msg … source="agent">`
with `<sender>` and a single `<body>` (all source text encoded there). **Block** content: each
**text** block is XML-encoded; the shell is split so **concatenating decoded text from all text
blocks** yields one envelope whose `<body>` is the **concatenation of all original text blocks**
(in order). **Non-text** blocks (image, …) are **unchanged** and stay in the ACP block list in
order — often **between** the text blocks that carry the split shell, not “after” one root element.

Receivers with a **single string** prompt: treat it as an envelope only if the **whole string**
is a valid v1 envelope; otherwise use it as raw text. Receivers with **blocks**: decode text
blocks and apply the same whole-envelope rule to the joined text, or handle raw blocks when parse
fails. Valid envelope or raw fallback — a leading root tag alone is **not** enough.

A complete valid envelope pasted as the whole message parses like any other envelope — still
**not** proof of who sent it or user approval. System envelopes (`source="system"`,
`<event-kind>…</event-kind>`, `<subject-agent>`, …) are for subscriber/event delivery, not
ordinary `session/prompt` from the FE.

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
