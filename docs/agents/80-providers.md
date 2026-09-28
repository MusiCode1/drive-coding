---
id: providers
title: CLI providers — registry and availability
summary: Which CLI kinds exist, how overrides merge, and how to detect installed binaries on this host.
read_when:
  - You need to pick a cli kind for session_open or POST /api/agents
  - You want to know whether cursor vs claude is installed before spawning
  - You are debugging a spawn failure tied to an unknown or missing CLI binary
tags: [providers, config]
surface: [http]
stability: stable
routes:
  - GET /api/cli-availability
  - GET /api/cli-logo/:cliId
docs_version: 1.0.0
updated: 2026-09-28
---

# CLI providers

## Effective registry

Built-in specs live in **`CLI_SPECS`** (`packages/core/src/schemas/agent.ts:89-119`).

The **effective** registry at runtime is **`CLI_SPECS ⊕ cli-specs.jsonc`** — file overrides can change bins and add kinds (`agent.ts:132-134`, `http-cli-availability.ts:25-31`).

**Do not treat `CLI_SPECS` alone as the full provider list.** For the live set on this backend, call **`GET /api/cli-availability`**.

Kind literals for compile-time checks: **`CLI_KINDS`** (`agent.ts:122`).

## GET /api/cli-availability

Returns `{ available, details, … }` from **`detectAvailableClis`** on merged specs (`http-cli-availability.ts:21-34`).

| Status | Anchor |
|--------|--------|
| `200` | `http-cli-availability.ts:34` |

## GET /api/cli-logo/:cliId

Serves a local logo file for a known CLI kind when configured.

| Status | When | Anchor |
|--------|------|--------|
| `404` | Unknown CLI | `http-cli-logo.ts:47` |
| `404` | CLI has no logo | `http-cli-logo.ts:52` |
| `404` | Remote logo URL (not served) | `http-cli-logo.ts:61` |
| `404` | Logo file missing on disk | `http-cli-logo.ts:84`, `http-cli-logo.ts:91` |
| `415` | Unsupported logo file type | `http-cli-logo.ts:75` |
| `413` | Logo file too large | `http-cli-logo.ts:95` |
| `200` | Bytes with Content-Type | `http-cli-logo.ts:101` |

Deploy defaults and schema for overrides: `deploy/cli-specs.jsonc` and `.schema.json`.
