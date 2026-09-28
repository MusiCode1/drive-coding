---
id: cli
title: drive-coding CLI — local HTTP client
summary: The drive-coding agent subcommand talks to a running backend; commands map to documented HTTP routes.
read_when:
  - You run on the same machine as the backend and prefer a shell client over raw curl
  - You need the discovery order for --base, --port, and DRIVE_CODING_BASE
  - You want to know which CLI command equals DELETE or POST on the HTTP API
tags: [cli]
surface: [cli]
stability: stable
routes: []
docs_version: 1.2.0
updated: 2026-09-28
---

# drive-coding CLI

The **`drive-coding agent`** subcommand is a thin HTTP client over a running backend (`packages/backend/src/cli/help.ts`, `packages/backend/src/cli/http.ts`).

## Server discovery

Resolution order for agent commands (`help.ts:7-12`):

1. **`--base <url>`** (wins)
2. **`--port <n>`** → `http://127.0.0.1:<n>`
3. **`DRIVE_CODING_BASE`**
4. Instance registry — unique live row, else exit `1`

`PORT` is **not** read. Zero or multiple live instances → exit `1`.

## Commands vs HTTP

| CLI | HTTP equivalent | Notes |
|-----|-----------------|-------|
| `agent list` | `GET /api/agents` | `help.ts:16` |
| `agent open` | `POST /api/agents` | `--cli`, `--cwd`, `--parent`, env forwarding (`help.ts:23-33`) |
| `agent send` | `POST /api/agents/:id/rpc` (prompt) + SSE wait | `--no-wait` skips wait (`help.ts:35-45`) |
| `agent state` | `GET /api/agents/:id/state` | `help.ts:19` |
| `agent close` | `DELETE /api/agents/:id` | **`help.ts:20`** → `http-agents.ts:148` → **`deleteAndKill` removes one id only** |
| `agent notify` | Fire-and-forget prompt on live session | `help.ts:47-49` |
| `instances` | Registry listing (not the agents API) | Always exit `0` (`help.ts:15`) |

## Close semantics

**`agent close`** maps to **`DELETE /api/agents/:id`** and deletes **that agent id only** — there is no recursive walk of `parentAgentId` in `deleteAndKill`.

Parent and child sessions are independent for close; see `70-subagents`.

## Equivalence gaps

The CLI does not wrap every HTTP route (filesystem, voice, MCP, diagnostics). For those surfaces use HTTP or MCP as documented in sibling agent docs.
