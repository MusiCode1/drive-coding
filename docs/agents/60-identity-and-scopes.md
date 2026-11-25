---
id: identity
title: Agent identity and scoped writes
summary: Agent identity, environment passed to tools, and scope tokens for writes.
read_when:
  - You need to know your agent id or scope token at runtime
  - You need to pass environment variables to an agent or understand sidecar restore
  - A write to another agent was denied or you must answer a scope permission prompt
  - You are reviewing whether scoped writes protect against malicious agents
tags: [identity]
surface: [http, mcp]
stability: stable
routes:
  - POST /api/agents/:id/reply
  - GET /api/scope-policy
  - PATCH /api/scope-policy
mcp_tools:
  - session_whoami
  - agent_whoami
docs_version: 1.16.0
updated: 2026-11-25
---

# Agent identity and scoped writes

## Who you are

Your agent id travels on two channels (`agent-identity.ts:24-27`, `agent-identity.ts:33-50`):

- **Environment:** `DRIVE_CODING_AGENT_ID` in the CLI and its tools.
- **HTTP/MCP header:** `X-Drive-Coding-Agent` on requests to this backend.

Discovery also lists `agent_whoami`. The canonical result uses `agentId`, `agentNotes` and `agentFields`. Both use the registered caller header.

MCP **session_whoami** (no parameters) reads the id from the `X-Drive-Coding-Agent` header
only — it never guesses from the environment, and a missing or unknown header is an error. It
returns `agent`, `cliKind`, `cwd`, `hasParent`, `sessionId`, your note and fields if set, a
`backend` block (`pid`, `port`, `version`, `uptimeSec`, `publicBaseUrl`, memory budget) and a
`runtime` block (CLI `pid`, `attached`, `busy`, `via`, child memory — Linux only; elsewhere
`memory` is `null`). It is discovery, not authentication.

## Agent environment

Every launch route supplies `DRIVE_CODING_AGENT_ID`, `DC_TOKEN`, `DC_BASE`, and
`DRIVE_CODING_BASE` to the agent's tools. This covers direct spawn, in-process
adapters, and both pipe and hosted sidecars. For Codex, the values reach the
long-running `codex app-server`, including its replacements after recovery.
The backend sets both base variables to its loopback URL.

Pass a string-to-string `env` map to `POST /api/agents` or MCP **session_open**
to supply additional values. The backend's identity and base values take
precedence over matching caller keys.

Sidecar requests accept up to 60 KiB (61,440 bytes) of base64-encoded UTF-8
JSON environment, including the base and parent fields added by MCP. The
launch payload has a 64 KiB (65,536-byte) limit including server-added keys.
Oversized sidecar requests return HTTP 400 or an MCP tool error before
creating an agent.

On backend restart, restore attaches to surviving sidecars with the
environment they received at launch. If a sidecar disappears before the
restore attach, the backend marks that agent as crashed.

## Scope token

Scoped writes use (`agent-scope.ts:29-31`):

- Header **`X-Drive-Coding-Scope`** or env **`DC_TOKEN`** — a signed token binding the caller to one agent id (`agent-scope.ts:58-61`, `agent-scope.ts:65-83`).
- Optional **`DC_MASTER_KEY`** — when the token equals this env value, all scoped writes are allowed (`agent-scope.ts:86-90`).

Your **subtree** is the set of agent ids reachable via `parentAgentId` links, including yourself. Computation is cycle-safe and depth-capped at **`SUBTREE_MAX_DEPTH = 20`** (`agent-scope.ts:34`, `agent-scope.ts:94-113`).

## What scoped writes protect

Scoped writes to one session use `authorizeWrite()` in `agent-scope.ts`. It allows when:

- No token was sent → **`"allow"`**.
- Token is master key → allow.
- Target id is inside the caller's subtree → allow.
- Caller has a prior **allow_always** grant or an applicable reply grant → allow.
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

## Scope action policy (message / update / close)

Three independent global selectors — **`ask`**, **`allow`**, or **`deny`** — one per action group. Defaults are **`ask`** for all three. Policy applies only when a scoped token writes **outside** the caller's subtree (same gate as above); missing token, master key, in-subtree targets, and existing `allow_always` grants behave unchanged.

| Group | Examples |
|-------|----------|
| **message** | MCP `session_send`, RPC `session/prompt` and `session/cancel`, subscriptions |
| **update** | HTTP `PATCH`, `POST …/reply`, viewer detach, RPC config/session control methods |
| **close** | HTTP `DELETE` agent, MCP `session_close`, RPC `session/delete` |

Unclassified RPC (e.g. `_drive/ext`) always **`ask`** on escalation even when all selectors are **`allow`**.

### Permanent grants and reply grants

A permanent grant for `send`, `session/prompt`, or `session/cancel` covers all three
actions for the same caller and target. Other permanent grants apply to their own verb.

When a caller with a valid scoped agent token dispatches a prompt through MCP
`session_send` or RPC `session/prompt`, the recipient can send, prompt, or cancel a turn
on that caller. The grant starts at dispatch. It still applies if the provider later
rejects the prompt, and either agent's normal closure removes it. It applies only to
that pair and those three actions. Cancellation, system notifications, `notify_parent`,
and sends without a scoped agent token do not create it.

### Agent HTTP write routes

| Write | Scope decision |
|-------|----------------|
| `POST /api/agents` | Creation is exempt |
| `DELETE /api/agents` | A valid scoped token closes its subtree and reports other agents in `skipped`. An invalid token returns `403` before closing any agent. With a master token or no token, the result is `{ closed, failed }` for the full fleet. |
| `DELETE /api/agents/:id` | Close policy for the target |
| `PATCH /api/agents/:id` | Update policy for the target |
| `DELETE /api/agents/:id/connection` | Update policy for the target with the separate `detach` verb |
| `POST /api/agents/:id/presence` | Viewer heartbeat is exempt |
| `POST /api/agents/:id/reply` | Update policy for the target |
| `POST /api/agents/:id/rpc` | Policy for the RPC action. The read-only `session/list` is exempt. |
| `POST /api/agents/:id/subscribe` | Message policy for the subscriber |

HTTP subscribe and MCP `session_subscribe` check the effective subscriber. A permanent
`subscribe` grant lets the caller register that subscriber for events from any session.
The prompt identifies both the subscriber and the watched session. `notifyOnDone` on
agent creation currently registers without a subscriber scope decision.

### HTTP API

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/api/scope-policy` | — | Global `{ policies, sources }` snapshot |
| `GET` | `/api/scope-policy?agent=<uuid>` | — | **Effective** snapshot for that caller agent (`404` if id unknown) |
| `PATCH` | `/api/scope-policy` | `{ policies: { message?, update?, close? } }` — at least one declared key; **no** extra keys at top level or under `policies` (`400`) | Global snapshot (override layer) |
| `PATCH` | `/api/scope-policy` | `{ agent: "<uuid>", policies: { message?, update?, close? } }` — same key rules; **`null`** on a key **clears** the per-agent override for that group (`404` if agent unknown) | Effective snapshot for that agent |

Both response shapes use **`Cache-Control: no-store`**. **`sources`** values: **`agent`** (per-agent row on `agents.json`), **`override`** (live global PATCH in this process), **`env`** (effective process ENV for that group), **`default`** (product default when ENV omitted/invalid). Global PATCH overrides are **in-memory only** — lost on backend restart; **per-agent** values persist in **`agents.json`** across restart.

Per-agent policy is a **guard-rail convenience**, not a security boundary: any HTTP client may set it; visibility comes from **`sources: "agent"`** and the public stance in **`NOT_A_SECURITY_BOUNDARY`**.

**`allow`** on a group permits matching cross-subtree writes **without** a UI prompt (no caller host required). **`deny`** rejects without creating a prompt. **`ask`** keeps the existing escalation + permission flow.

MCP **`session_send`** with non-empty **`sets`**: the backend checks **update** (`session/set_config_option`) then **message** (`send`); if either group denies, the whole call fails with scope-denied and **no** config/prompt side effects.
