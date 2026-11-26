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
docs_version: 1.18.0
updated: 2026-11-25
---

# Agent session RPC

`POST /api/agents/:id/rpc` accepts a JSON body `{ "method": "<name>", "params": { … }, "waitMs"?: number }`.
RPC creates a session host on demand. A missing or dead agent connection returns `404`. An agent that requires authentication returns `401`.

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
| `session/list` | List sessions exposed by the CLI, with optional folder filtering and pagination. |
| `session/delete` | Delete a session by `params.sessionId`. |
| `_drive/ext` | Extension dispatch (`params.method`, optional `params.params`). |
| `_drive/set_session_model` | Legacy model override (`params.model`) — prefer config options when available. |

## Listing sessions

Use `session/list` over HTTP RPC or send the same body in the WebSocket RPC request.
`listSessions` is the legacy alias and accepts the same arguments.

```json
{"method":"session/list","params":{"paged":true,"cwd":"/demo/project"}}
```

Including `paged: true`, `cwd`, or `cursor` selects the paged response. Use an
absolute POSIX, drive-rooted Windows, or UNC path for `cwd`. Omit it to list
across the folders available to the provider. In this example the first page returns
an empty list with a cursor. An empty page can still have a next page.

```json
{
  "sessions": [],
  "sessionCapabilities": {"list": {}},
  "capabilities": {"list": true, "filterByCwd": true, "delete": false},
  "nextCursor": "opaque-page-token"
}
```

For the next page, send the same `cwd` with the returned cursor.

```json
{"method":"session/list","params":{"cwd":"/demo/project","cursor":"opaque-page-token"}}
```

Copy the cursor exactly, including whitespace or an empty string. The server
omits `nextCursor` at the end, including when the provider returns `null`.
`sessionCapabilities` carries the provider's raw declaration or `null`.
Use the boolean `capabilities` fields to decide which actions to offer.

A request with omitted, `null`, or empty `params` returns the legacy
`{ "sessions": [], "sessionCapabilities": null }` shape, with actual sessions
and the raw capabilities when available. Unknown parameter keys are ignored.
A request containing only unknown parameter keys also uses the legacy shape.

A warm ACP v1 attachment without initialization metadata returns an empty paged
response with `sessionCapabilities: null`, all three capability flags set to
`false`, and `legacyOnly: true`. On the first page, a client can retry once with
`params: {}` and use that single legacy page, filtering by folder locally. If
the marker arrives during pagination, stop and keep the pages already loaded.
An explicit refresh can then start the first-page flow again. The paged call on
this attachment makes no upstream list request.

Invalid list params get `400` before the session host is requested. On an
initialized connection, an absent list capability returns `200` with an empty
list. An upstream `-32601` has the same fallback. In a paged fallback, `list`
and `filterByCwd` are `false`. Deletion is gated independently. Other upstream
errors return `502` with `error` and
the provider's `code` when available, including `-32602` for rejected arguments.

`session/delete` keeps its scope check and validates `params.sessionId` before
requesting the host. An absent delete capability or upstream `-32601` returns
`200` with `{ "ok": false, "unsupported": true }`. A warm v1 attachment without
capability metadata can still forward an explicit, authorized legacy delete
request. Other upstream delete errors use the same `502` mapping.

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

Six methods honor optional top-level `waitMs` (1–60000) on the HTTP handler (`dispatchRpcBody`):

- `session/prompt` · `session/cancel` · `session/set_mode` · `session/set_config_option` · `_drive/ext` · `_drive/set_session_model`

Without `waitMs` (or `0`), those six return **`202`** with `{ version }` only (`dispatchRpcBody`).
With valid `waitMs`, the handler waits and returns **`200`** result bodies (or **`200`** `{ ok: false, timedOut: true }` on timeout — `respondRpcWait`).
Invalid `waitMs` on those six → **`400`** `{ error: "invalid waitMs" }` (`dispatchRpcBody`).

`session/prompt` (including the legacy `prompt` alias) checks `params.sessionId` against the active session just before dispatch. If the ID differs, the host has no active session, or a switch has started but has yet to assign its target ID, the response is **`409`** with `{ error: "Prompt session no longer matches the active session", code: "prompt_session_mismatch" }`. This applies with or without `waitMs`. The rejected request creates no user message or turn. To retry, wait until the original session is active and send the prompt to that session.

Management methods (`session/list`, `session/load`, `session/new`, `session/delete`) **ignore** `waitMs` and return method-specific status codes. Any **`session/load`** while a turn is active returns **`409`** with `{ error, code: "session_busy" }`. The active turn continues. **`session/new`** is still allowed during a turn.

## HTTP status codes

| Status | When | Anchor |
|--------|------|--------|
| `401` | Agent authentication required, with `kind: "auth_required"` and `authMethods` | `host-failure.ts` |
| `404` | Agent connection missing or dead | `host-failure.ts` |
| `400` | Invalid JSON | `registerRpcRoute` in `http/rpc.ts` |
| `400` | Unknown method | `dispatchRpcBody` in `channel/rpc-dispatch.ts` |
| `400` | ArkType param errors (`p.summary`) | `rpc-dispatch.ts`, `rpc-session-mgmt.ts` |
| `400` | `load`/`new` without cwd | `rpc-session-mgmt.ts` |
| `202` | Fire-and-forget success for the six wait-capable methods | `dispatchRpcBody` |
| `200` | Blocking wait results, management results, or `-32601` degradations | `rpc-respond-wait.ts`, `rpc-session-mgmt.ts` |
| `409` | Any `session/load` while a turn is active | `rpc-session-mgmt.ts` |
| `409` | `session/prompt` target mismatch before dispatch | `rpc-prompt.ts` |
| `502` | Upstream/session errors on management calls | `rpc-session-mgmt.ts` |

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
| `session/prompt` | ArkType `PromptParams` | `400` + `error` summary (`rpc-dispatch.ts`) |
| `session/cancel` | ArkType `CancelParams` | `400` (`rpc-dispatch.ts`) |
| `session/load` | ArkType / missing cwd | `400` (`rpc-session-mgmt.ts`) |
| `session/new` | ArkType / missing cwd | `400` (`rpc-session-mgmt.ts`) |
| `session/delete` | ArkType `DeleteSessionParams` after scope check | `400` (`rpc-dispatch.ts`) |
| `session/list` / `listSessions` | ArkType `ListSessionsParams` | `400` (`rpc-dispatch.ts`) |

## OpenAPI

Request and response shapes for the HTTP surface (including partial schema coverage for `params`) live in `docs/agents/openapi.json` alongside the other routes.
