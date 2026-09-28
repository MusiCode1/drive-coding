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
  - DELETE /api/agents
mcp_tools:
  - session_open
  - notify_parent
docs_version: 1.1.0
updated: 2026-09-28
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

## notify_parent

Registration lives in **`delivery/agent-events-mcp-tools.ts:99`** (not `mcp-write-tools.ts`).

**`notify_parent` appears in the MCP tool list only when the session has `parentAgentId`.** A root session will not see it — that is expected, not a bug (`agent-events-mcp-tools.ts:95-99`).

The tool prompts the parent's live session with your text (`agent-events-mcp-tools.ts:102-117`).

HTTP alternative for event delivery: **`POST /api/agents/:id/subscribe`** (documented in `97-transports`).

## Closing agents — no cascade

**Closing a parent does not close its children.** Each child must be **`session_close`** / **`DELETE /api/agents/:id`** on its own id.

- **`DELETE /api/agents/:id`** → `deleteAndKill` removes **one** agent id (`http-agents.ts:148-154` → orchestrator).
- **`DELETE /api/agents`** (no id) → **`deleteAllAndKill`** — fleet wipe, **not** a parent/child cascade (`http-agents.ts:145`).

| Route | Status | Anchor |
|-------|--------|--------|
| `DELETE /api/agents` | `200` JSON summary | `http-agents.ts:145` |
| `DELETE /api/agents/:id` | `204` empty body | `http-agents.ts:154` |
| `DELETE /api/agents/:id` | `404` when id missing | `http-agents.ts:151` |

Do not describe recursive or cascade deletion; it is not implemented in `deleteAndKill`.
