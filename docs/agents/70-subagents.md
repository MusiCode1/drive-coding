---
id: subagents
title: Subagents — spawn, parent identity, notify_parent
summary: Open child agents, detect when you are a child, report to the parent, and what closing does not do.
read_when:
  - You were spawned with a parent and need to signal completion or status upstream
  - You want the injected surface prompt text for your session
  - You are about to delete agents and need to know whether children are closed automatically
tags: [subagents, session]
surface: [http, mcp]
stability: stable
routes:
  - GET /api/agent-prompt
  - DELETE /api/agents/:id/subscribe
  - DELETE /api/agents
mcp_tools:
  - session_open
  - agent_unsubscribe
  - notify_parent
  - session_surface
docs_version: 1.14.0
updated: 2026-11-25
---

# Subagents

## Opening a child

Use MCP **session_open** (see `20-session-lifecycle`) with `parentAgentId` on the HTTP create path, or **`drive-coding agent open --parent <id>`** (`cli/help.ts:27-28`).

The child receives **`DC_PARENT`** in its environment when the server sets `parentAgentId` (`prompts/surface/runtime.ts:70-71`, `runtime.ts:119`).

## Knowing you are a child

- Env **`DC_PARENT`** — parent agent id (`runtime.ts:70-71`, `runtime.ts:119`).
- MCP **session_whoami** and registry metadata expose the same relationship.

## Surface prompt injection

**`GET /api/agent-prompt`** returns the composed surface markdown for a live agent (`http-agent-prompt.ts:75`).

| Status | When | Anchor |
|--------|------|--------|
| `400` | Missing agent id (query `?agent=` or `X-Drive-Coding-Agent`) | `http-agent-prompt.ts:86` |
| `404` | Unknown agent id | `http-agent-prompt.ts:91` |
| `200` | Plain-text body | `http-agent-prompt.ts:105` |

Hooks and MCP **session_surface** use the same builder; this route is the HTTP mirror.
Call **session_surface** (no parameters; identity from `X-Drive-Coding-Agent`) when no CLI
hook delivered the prompt: it returns the same plain-text body — what this product is, how to
reach this backend, the session-bus tools, how to show the user files, images and diagrams,
and your session memory.

## notify_parent

`registerAgentEventMcpTools` in `delivery/agent-events-mcp-tools.ts` registers this tool.

**`notify_parent` appears in the MCP tool list only when the session has `parentAgentId`.**

The tool prompts the parent's live session with your text.
When you are a known caller, that text is wrapped as **`drive-coding-msg` v1** with **`sender`**
set to **your** agent id/name and **`body`** equal to the notify text — same shape as
**session_send**. The parent should read **`sender`** as “which child spoke”, not as proof the
user typed the message.

HTTP alternative for event delivery: **`POST /api/agents/:id/subscribe`** (documented in `97-transports`).
To stop receiving those events, call **`agent_unsubscribe { agentId: "<watched>" }`** with
your identity header or **`DELETE /api/agents/:id/subscribe`** with
`{ "subscriberAgentId": "<your agent id>" }`. The same calls stop registrations made through
`notifyOnDone`.

## Closing agents

`session_close` and `DELETE /api/agents/:id` close one agent. Children stay open.

`DELETE /api/agents` returns a report with `closed` and `failed` arrays. A valid scoped
token limits the operation to the caller and its descendants and adds
`skipped: [{ id, reason: "scope" }]` for agents outside that subtree. With a master
token or no token, it attempts to close every agent and omits `skipped`.

| Route | Status |
|-------|--------|
| `DELETE /api/agents` | `200` with per-agent results |
| `DELETE /api/agents` | `403` with `scope-denied` for an invalid token |
| `DELETE /api/agents/:id` | `204` after closing the agent |
| `DELETE /api/agents/:id` | `404` when the agent is absent |
