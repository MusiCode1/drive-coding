---
id: session-lifecycle
title: Session lifecycle — open, send, close
summary: How to open an agent, drive a turn, close it, and keep session viewers alive.
read_when:
  - You need to spawn an agent and get its id
  - A turn is running and you must decide between waiting and forcing
  - You are about to leave an agent open and want to understand viewer lifetimes
tags: [session, ownership, turnstate]
surface: [http, mcp]
stability: stable
routes:
  - GET /api/agents
  - POST /api/agents
  - GET /api/agents/:id
  - DELETE /api/agents/:id
  - PATCH /api/agents/:id
  - POST /api/agents/:id/presence
mcp_tools:
  - session_list
  - agent_list
  - session_open
  - agent_open
  - session_send
  - agent_send
  - session_state
  - agent_state
  - session_close
  - agent_close
  - session_note_set
  - agent_note_set
  - session_field_set
  - agent_field_set
  - session_field_delete
  - agent_field_delete
docs_version: 1.17.0
updated: 2026-11-26
---

# Session lifecycle

**You open it, you close it.** Whoever creates an agent is responsible for closing it
when work finishes — including when a turn is already running.

## Typical MCP workflow

1. **session_list** — agents already on this backend (`id`, `cliKind`, `cwd`, `turnState`, …).
   Same data as `GET /api/agents`.
2. **session_open** — spawn with `cli` + absolute `cwd`; blocks up to ~30s for `sessionId`.
   Returns `agent` UUID, `url`, live `modes` and `configOptions` catalog, plus a configure hint.
3. **session_send** — user prompt; waits for turn end by default (1800s cap) unless `noWait`
   or timeout. Optional `sets` applies config before the prompt (see `30-child-config`).
   When the caller is a known agent (MCP identity header), content is wrapped in
   **`drive-coding-msg` v1** (`source="agent"`): string prompts become one XML document;
   block prompts split the XML across **text** blocks (prefix/suffix on first/last text block)
   while **image and other non-text blocks stay separate** in the ACP sequence — often
   **interleaved** between those text blocks.
4. **session_state** — read `turnState`, errors, catalog without pulling full message logs.
5. **session_close** — delete record and kill CLI; refuses when `turnState !== idle` unless
   `force: true`.

Re-use an existing agent from **session_list** instead of spawning duplicates.

HTTP mirrors the same lifecycle: `POST /api/agents` (create), agent-scoped routes under
`/api/agents/:id/…`, `DELETE /api/agents/:id` (close).
To subscribe an existing agent to the new agent's events, pass its UUID in
`notifyOnDone` or `subscribeOnOpenAgentId` at creation. If you supply both,
they must match. The server creates one subscription and honors
`includeLastAssistantText`.

## MCP tool names

Discover the tools and their input schemas with `tools/list`. The workflow above
uses the legacy names. Use the input schema of the specific tool you call.

| Workflow name | Alternate name | Canonical input or result |
|---|---|---|
| `session_list` | `agent_list` | Result items keep `id` and expose `agentNotes`, `agentFields` and `viewerCount`. |
| `session_open` | `agent_open` | Pass `cliKind` and absolute `cwd`. Optional renamed inputs are `permissionPolicy`, `parentAgentId` and `subscribeOnOpenAgentId`. The canonical URL input is `publicUrl`. The result uses `agentId`. |
| `session_send` | `agent_send` | The target input is `agentId`. The result is the same in both forms. |
| `session_state` | `agent_state` | The target input and identity in the result are `agentId`. |
| `session_close` | `agent_close` | The target input and identity in the result are `agentId`. |
| `session_subscribe` | `agent_subscribe` | Uses `agentId` and `subscriberAgentId`. |
| `session_whoami` | `agent_whoami` | Returns `agentId`, `agentNotes` and `agentFields` when available. |
| `session_surface` | `agent_surface` | Both return the same Markdown prompt. |
| `session_note_set` | `agent_note_set` | Both replace the caller's note using `text`. Empty text clears it. |
| `session_field_set` | `agent_field_set` | Both set one field using `key` and `value`. |
| `session_field_delete` | `agent_field_delete` | Both delete one field using `key`. |

If you explicitly call `agent_open`, use the returned `agentId` as the `agent`
argument in the recommended `session_state`, `session_send` and `session_close`
workflow. Apply config with `session_send.sets` using IDs from the live catalog.

Example workflow inputs (with a synthetic agent ID and workspace):

```text
session_open  {"cli":"cursor","cwd":"/path/to/workspace"}
session_send  {"agent":"00000000-0000-4000-8000-000000000001","prompt":"Review the plan","sets":{"<option-id>":"<allowed-value>"}}
session_close {"agent":"00000000-0000-4000-8000-000000000001"}
```

## Open (spawn)

Required inputs:

- **`cli`** — ACP CLI kind (`cursor`, `claude`, `codex`, `opencode`, …).
- **`cwd`** — absolute working directory for the child.

Optional highlights:

- **`permission`** — policy for the new agent (`allow_once`, `allow_always`, `reject_once`, `ask`).
- **`parent`** / header **`X-Drive-Coding-Agent`** — sub-agent wiring (`parentAgentId`).
- **`closeOnTurnEnd`** — auto-close after first clean turn end.
- **`publicUrl`** — base for the returned chat link. With legacy `session_open`, `base`
  also works and `publicUrl` takes precedence when supplied, including an empty string.
  With canonical `agent_open`, use `publicUrl`. By default, both use the instance's
  configured public origin, falling back to its local HTTP base. MCP ignores `port`.

MCP **`session_open`** returns `{ agent, sessionId, url, cli, modes, configOptions, hint }`.
The link is `<base>/chat/<cliKind>/<sessionId>?sessionTransport=http`. An empty
`publicUrl` returns a relative link. The child uses the instance's local API address
through `DRIVE_CODING_BASE` and `DC_BASE`, and receives its own agent identity at launch.
The hint explains that **`sets` on session_send** must use ids from that catalog.

## Send (drive a turn)

**session_send** (and HTTP RPC `session/prompt`) runs a turn.

- Default: block until the turn ends or **`timeoutSec`** (default 1800).
- **`noWait: true`** → immediate `{ running: true }`; fetch output via **session_state**,
  `GET /api/agents/:id/history`, or SSE (`40-reading-output`).
- While **`turnState` is not `idle`**, another blocking send may queue or conflict — inspect
  state before forcing.

When **`turnState !== idle`**:

- **session_close** / `DELETE` / CLI `close` **refuse** unless **`force: true`** (or CLI
  `--force`). Prefer waiting for idle unless you accept a hard stop.
- Closing with force while a turn runs still kills the process; log may record prior turn state.

## Close

**session_close** calls the same **`deleteAndKill`** path as `DELETE /api/agents/:id` and
`drive-coding agent close`.

- Missing agent → MCP may return `{ ok: true, alreadyClosed: true }`; HTTP DELETE → 404.

Closing an agent — `DELETE /api/agents/:id`, **session_close**, or `drive-coding agent close`
— all reach the same **`deleteAndKill`** and close **that agent only**. Children linked by
**`parentAgentId` are not** closed with it: they keep running and you must close each one
yourself (`agent-orchestrator.ts:260-284` · `http-agents.ts:135-142`).

MCP close checks write scope before checking the agent and turn state. See [identity and scopes](60-identity-and-scopes.md).

## Viewer groups and liveness

SSE and WebSocket viewers can share a session. Each viewer renews its own connection
row with **`POST /api/agents/:id/presence`** (empty body) and its
**`Acp-Connection-Id`** header.

Both transports use **`HTTP_OWNER_TTL_MS`** (config key `httpOwnerTtlMs`, default
600000 ms or 10 minutes). Expiry ends the stale viewer's stream and removes its
connection row. The session host and agent survive, and other viewers can continue.
WebSocket pings maintain socket liveness. Presence renews the viewer TTL.

The first viewer after the group becomes empty starts a new epoch. Additional
viewers share it. An older `?epoch=` is rejected before attach with **409** on SSE
or **4409** on WebSocket. The **`taken-over`** event remains in the protocol for
compatibility. This server never emits it. See `40-reading-output`.

## Identity header

MCP requests from spawned children may include **`X-Drive-Coding-Agent: <uuid>`** for
caller identity (`parentAgentId` on open, **notify_parent** eligibility). **session_whoami**
returns your id and runtime envelope — the server does not guess from env alone.

## Inbound prompt envelope (receiver)

**session_send** (and related paths) may deliver **`drive-coding-msg` version="1"**:

- **`source="agent"`** — **`sender`** is who sent; **`body`** is their message text.
- **`source="system"`** — **`<subject-agent>`** is the session the event refers to;
  **`<last-assistant-text>`** quotes the last **assistant** message in that session (may be from a
  **prior turn**, may be **truncated**). On the wire: **`<event-kind>turn-ended</event-kind>`**
  means the turn ended, not that the user's task succeeded;
  **`<event-kind>stall-suspected</event-kind>`** is suspicion only (parsed object field:
  `eventKind`).
- Optional **`<context kind="project-charter">`** is project background — **not** the sender's words.

**Trust boundary:** a string is treated as an envelope only when the **entire** text is one
valid v1 envelope. Tags inside prose or examples are **not** detected as envelopes. A **complete**
valid envelope pasted as the whole message parses the same way — still **not** proof of identity
or user approval. The UI may show envelope XML as plain text today — see `render-contract`.

## Agent memory — your own note and fields

Three MCP tools let an agent keep memory on **its own** agent record, so it outlives a
compaction or a reconnect. They take no agent id: the caller is identified by the
`X-Drive-Coding-Agent` header only, and a call without it (or with an unregistered id) is an
error. Each returns `{ "ok": true }`.

| Tool | Input | Effect |
|---|---|---|
| `session_note_set` | `{ text }` | Replaces the whole note (`userNotes`). |
| `session_field_set` | `{ key, value }` | Sets one entry of `sessionFields` (string → string); other keys are kept. |
| `session_field_delete` | `{ key }` | Removes one entry; deleting a missing key is still `ok`. |

Keys are trimmed; an empty key is rejected. Where the memory shows up:

- in `session_list` and `session_whoami` as `userNotes` and `sessionFields`, and in
  their canonical equivalents as `agentNotes` and `agentFields`;
- in `GET /api/agents` and `GET /api/agents/:id` under both names, with the same value
  for each pair. Unset values are omitted. Empty notes and empty field maps are returned.
  A single-record GET reflects a completed write. The list can serve a separate snapshot
  for up to 1.5 seconds and sends `Cache-Control: no-store`;
- in the UI: **Agent notes** in chat and the read-only **Agent fields** list in the
  side panel. Both follow the same agent across its ACP sessions;
- in the agent's own surface prompt (hook, `GET /api/agent-prompt`, `session_surface`), as a
  `# Agent memory` section with `## Notes` and `## Fields` — so the agent reads it back.

`PATCH /api/agents/:id` accepts `userNotes` or `agentNotes`. If both are present, they
must match. An empty string clears the note. Omitting both leaves it alone. Fields are
read-only over HTTP. The browser displays the note from the agent record on attach
or reconnect and sends a debounced `userNotes` PATCH when the user edits it. An MCP
edit can be read from the record immediately after it completes and appears in the
browser the next time it loads that record.

## Configure during lifecycle

Do not guess option names at open/send time — read **`configOptions`** and **`modes`** from
**session_open** / **session_state**, then pass **`sets`** on **session_send**. Details in
`30-child-config`.

## CLI equivalents

```bash
drive-coding agent list [--json]
drive-coding agent open --cli cursor [--cwd DIR] [--parent ID] [--close-on-turn-end]
drive-coding agent send --agent ID --prompt-file FILE [--set id=value]
drive-coding agent state --agent ID
drive-coding agent close --agent ID [--force]
```

`--base` chooses the HTTP endpoint for the CLI, and `--public-url` overrides the printed
chat link base, which defaults to the endpoint the CLI used. The instance injects
**`DRIVE_CODING_BASE`** and **`DC_BASE`** into the child. With `--parent`, the child
also receives **`DC_PARENT`**.

## Limits (MCP)

- Stateless — poll **session_state** or use HTTP SSE for live updates.
- **session_send** ignores CLI-only fields (`file`, `marker`, `idleTimeoutSec`, `keep`).
- Kill switch: **`MCP_HTTP=0`** disables the MCP HTTP endpoint.
