---
id: diagnostics
title: Diagnostics, usage, options, and config reload
summary: Health vs diag, usage counters, client log ingest, hot config reload, and static options.
read_when:
  - You need to know if the backend loop is stalling or memory is climbing
  - You want token or CLI usage summaries without parsing agent logs
  - You changed config.jsonc and need HOT_KEYS applied without restart
tags: [diagnostics]
surface: [http]
stability: stable
routes:
  - GET /api/diag
  - GET /api/usage/summary
  - GET /api/usage/clis
  - GET /api/usage/tokens
  - POST /api/client-log
  - POST /api/reload-config
  - GET /api/options
docs_version: 1.0.0
updated: 2026-09-28
---

# Diagnostics and operations

## Liveness vs deep diag

- **`GET /api/health`** — simple alive check (see `10-connect`). Use for probes.
- **`GET /api/diag`** — rich snapshot: event-loop delay histogram, memory, per-agent runtime (`http-health.ts:52-108`).

| Route | Status | Anchor |
|-------|--------|--------|
| `GET /api/diag` | `200` JSON (short cache — `http-cache`) | `http-health.ts:57`, `http-health.ts:108` |

If the event loop is fully frozen, this handler never runs and the fetch times out — that timeout is itself a signal (`http-health.ts:7-9`).

## Usage

| Route | Status | Anchor |
|-------|--------|--------|
| `GET /api/usage/summary` | `200` | `http-usage.ts:17` |
| `GET /api/usage/clis` | `200` | `http-cli-usage.ts:19` |
| `GET /api/usage/tokens` | `200` | `http-token-usage.ts:17` |

## POST /api/client-log

Browser clients batch log lines to the server namespace `client.*` (`http-client-log.ts:50-87`).

| Status | When | Anchor |
|--------|------|--------|
| `400` | Bad JSON or schema | `http-client-log.ts:57`, `http-client-log.ts:62` |
| `429` | Rate limit (>500 entries/min/IP) | `http-client-log.ts:66` |
| `204` | Accepted | `http-client-log.ts:87` |

## POST /api/reload-config

Triggers config cache invalidation; **`HOT_KEYS`** only are reapplied at runtime (`http-reload-config.ts:17-19`, see `packages/backend/src/config/runtime-config.ts`).

| Status | Anchor |
|--------|--------|
| `200` `{ ok: true }` | `http-reload-config.ts:19` |

## GET /api/options

| Status | Body | Anchor |
|--------|------|--------|
| `200` | `{ homeDir }` | `http-options.ts:13` |
