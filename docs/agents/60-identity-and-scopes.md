---
id: identity
title: Agent identity and scoped writes
summary: Who you are on this backend, what DC_TOKEN does, and why it is not a security boundary.
read_when:
  - You need to know your agent id or scope token at runtime
  - A write to another agent was denied or you must answer a scope permission prompt
  - You are reviewing whether scoped writes protect against malicious agents
tags: [identity]
surface: [http, mcp]
stability: stable
routes:
  - POST /api/agents/:id/reply
docs_version: 1.0.0
updated: 2026-09-28
---

# Agent identity and scoped writes

## Who you are

Your agent id travels on two channels (`agent-identity.ts:24-27`, `agent-identity.ts:33-50`):

- **Environment:** `DRIVE_CODING_AGENT_ID` on spawned CLI processes.
- **HTTP/MCP header:** `X-Drive-Coding-Agent` on requests to this backend.

MCP **session_whoami** returns the same id when the header or env is set.

## Scope token

Scoped writes use (`agent-scope.ts:29-31`):

- Header **`X-Drive-Coding-Scope`** or env **`DC_TOKEN`** — a signed token binding the caller to one agent id (`agent-scope.ts:58-61`, `agent-scope.ts:65-83`).
- Optional **`DC_MASTER_KEY`** — when the token equals this env value, all scoped writes are allowed (`agent-scope.ts:86-90`).

Your **subtree** is the set of agent ids reachable via `parentAgentId` links, including yourself. Computation is cycle-safe and depth-capped at **`SUBTREE_MAX_DEPTH = 20`** (`agent-scope.ts:34`, `agent-scope.ts:94-113`).

## What scoped writes protect

`authorizeWrite()` (`agent-scope.ts:161-177`) is the single gate for dangerous writes (close, prompt, reconfigure) on **another** agent's session. It allows when:

- No token was sent → **`"allow"`** (`agent-scope.ts:164`).
- Token is master key → allow.
- Target id is inside the caller's subtree → allow.
- Caller has a prior **allow_always** grant → allow.
- Otherwise → **`onEscalate`** asks the caller's session for permission (`scope-write.ts:37-75`).

When escalation succeeds, the user (or parent agent) answers through **`POST /api/agents/:id/reply`** with a permission result (`reply.ts:40-67`).

### HTTP status — `POST /api/agents/:id/reply`

| Status | When | Anchor |
|--------|------|--------|
| `404` | No live session host for `:id` | `reply.ts:44-45` |
| `403` | Self-approve blocked for a scope permission on your own session | `reply.ts:52-55` |
| `400` | Unknown `kind` (not `permission` or `elicitation`) | `reply.ts:64` |
| `200` | `{ ok: true }` — including silent no-op when `requestId` is unknown | `reply.ts:59-67` |

## Not a security boundary

The canonical stance is **`NOT_A_SECURITY_BOUNDARY`** (`agent-scope.ts:26-27`):

> This is not a security boundary, and it is not meant to become one.

**All of the following bypasses are real and accepted:**

1. A spawned agent runs as the **same OS user** as the backend (`agent-scope.ts:6-8`).
2. The child inherits the **full process environment** (`spawn-core.ts` builds `{ ...process.env }`), so **`DC_MASTER_KEY`** and **`DC_SCOPE_SECRET`** are readable by any child (`agent-scope.ts:7-11`).
3. HTTP calls **without any scope header** → `authorizeWrite()` returns **`"allow"`** when there is no token (`agent-scope.ts:164`, `agent-scope.ts:10`).
4. A child can **edit the guard code** itself — same user, same filesystem (`agent-scope.ts:8`, `agent-scope.ts:17-20`).
5. The backend has **no authentication** of any kind on this surface (`agent-scope.ts:12`, `agent-scope.ts:17-20`).

Do not soften this list or suggest hardening here. The guard exists so a **confused agent pursuing an unrelated task** does not close, prompt, or reconfigure a **stranger's** session by accident (`agent-scope.ts:14-15`).
