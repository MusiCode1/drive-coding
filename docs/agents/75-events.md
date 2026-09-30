---
id: events
title: Agent events — subscribe and delivery
summary: Register for turn-ended and stall-suspected prompts on another agent's lifecycle.
read_when:
  - You opened a child agent and need to know when its turn ends or it may be stuck
  - You want the same subscription as notifyOnDone but after session_open returned
tags: [session, subagents]
surface: [mcp, http]
stability: stable
mcp_tools:
  - session_open
  - session_subscribe
docs_version: 1.4.0
updated: 2026-09-30
---

# Agent events

The backend can push **turn-ended** and **stall-suspected** notifications to a **subscriber** agent as a plain-text prompt injected into that subscriber's live session host (`formatAgentEventPrompt` in `agent-events-deliver.ts`).

## Event kinds

| Kind | Meaning |
|------|---------|
| `turn-ended` | The target agent's turn reached idle (the queue stopped). |
| `stall-suspected` | The target turn is still active but no frames arrived for longer than the stall threshold (default **10 minutes** while `turnState` is not idle). |

A **turn-ended** event proves the turn **stopped** — it does **not** prove the work succeeded, that artifacts were written, or that git state changed. Verify outcomes yourself.

**stall-suspected** is a silence alarm during an active turn, not proof of failure or a hung process.

## Registering

Two equivalent paths call the same in-memory bus (`eventBus.subscribe`):

1. **`notifyOnDone` on `session_open`** (MCP) or on **`POST /api/agents`** — auto-subscribes as soon as the child is created (`agent-events-orchestrator.ts`, `agent-events-http.ts`).
2. **`session_subscribe`** (MCP) or **`POST /api/agents/:id/subscribe`** (HTTP) — subscribe any time after the target exists.

### MCP `session_subscribe`

- **`agent`** — target agent UUID (the one you opened or care about).
- **`subscriber`** — who receives prompts. Defaults to **`X-Drive-Coding-Agent`** when omitted (`agent-events-mcp-tools.ts`).
- **`includeLastAssistantText`** — opt-in; when `true`, **turn-ended** prompts may include a truncated preview of the target's last assistant message (`formatAgentEventPrompt`, `agent-events-deliver.ts`).

### HTTP subscribe

Documented in **`97-transports`** (`POST /api/agents/:id/subscribe`). Body uses `subscriberAgentId` instead of `subscriber`.

## What you receive

Delivery uses **`formatAgentEventPrompt`** (`agent-events-deliver.ts`): a short facts-only block with `kind`, `agentId`, `at`, and optional `stopReason`, `silentMs`, `lastTurnError.message`, and (when opted in) `lastAssistantText` on turn-ended.

Prompt injection is **best-effort** into the subscriber's session host. There is no guarantee of delivery if the subscriber is gone, and **no replay** of events that fired before you subscribed.

## MCP reminder on open

When you **`session_open`** a child with a recognized **`X-Drive-Coding-Agent`** header and you are **not** already subscribed to that child, the JSON response may include a separate **`eventsHint`** field (not the always-on `hint`). It points you at **`session_subscribe`** and **`docs_get { id: "events" }`**. If you passed **`notifyOnDone`** for yourself, or subscribed before the response was built, **`eventsHint` is omitted**.

See also **`70-subagents`** for parent/child identity and **`97-transports`** for HTTP vs MCP surfaces.
