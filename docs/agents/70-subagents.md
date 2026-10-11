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
docs_version: 1.4.0
updated: 2026-10-11
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
| `DELETE /api/agents/:id` | `404` when no agent with that id exists in the registry | `http-agents.ts:150-151` |

Do not describe recursive or cascade deletion; it is not implemented in `deleteAndKill`.

## Detached from parent (`detachedFromParent`)

MCP **session_open** (and **POST /api/agents** with the same create body) accepts optional **`detachedFromParent: true`**.

**What it does today:**

- The opener is still **recorded** — `parentAgentId` is stored when you open from a parent context (for example the **`X-Drive-Coding-Agent`** header). **session_list**, **session_open** (response when you passed the flag), and **session_whoami** expose the flag on the agent record.
- The child is **not grouped under the parent** in the drive-coding UI agent tree. It appears as its own root row, not nested under the parent.

**What it does *not* do:**

- **Permissions are unchanged.** The parent can still **`session_close`** and **`session_send`** to a detached child without an extra scope prompt — same as any child opened by that parent.
- **There is no cascade close today.** Closing a parent still does **not** close children (see above). **`detachedFromParent` does not add cascade protection** because cascade deletion is not implemented. Do not tell users the flag “prevents cascade close.”

**Default:** omit the flag or pass `false` — behavior matches a normal owned sub-agent (nested under the parent in the UI).

**If you implement parent/child cascade close later:** when collecting children to close, filter with **`ownedChildren(await registry.list(), parentId)`** from `@drive-coding/core` — not raw `parentAgentId` equality alone — so detached agents stay open when a parent is deleted.
