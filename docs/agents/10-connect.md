---
id: connect
title: Connect — find the backend base URL and origins
summary: How to discover which drive-coding instance is running, which URL to call, and when to use loopback versus a public origin.
read_when:
  - You know a drive-coding backend is running but not which port or origin to call
  - A request to the backend failed and you are not sure the base URL is right
  - You need a URL the user can open in a browser, not a loopback address
tags: [connect]
surface: [http, mcp, cli]
stability: stable
routes: [GET /api/health]
docs_version: 1.2.0
updated: 2026-09-28
---

# Connect

Never guess a port. Use the discovery order below, then confirm with `GET /api/health`.

## Confirm the backend is alive

```http
GET /api/health
```

Response body (JSON):

```json
{
  "status": "ok",
  "version": "<semver>",
  "uptime": <seconds>,
  "service": "drive-coding"
}
```

Older servers may omit `service`; prefer checking `status` and `version`. Cache headers
are `no-store`.

Default listen address when nothing is configured: **`127.0.0.1:4000`** (`PORT` and
`DRIVE_CODING_HOST` override this — see human-facing `docs/configuration.md`).

## Discovery order (CLI and scripts)

When using **`drive-coding agent …`**, the CLI resolves the base URL in this order
(first match wins):

| Priority | Source | Notes |
|---|---|---|
| 1 | `--base https://…` or `--port <n>` | Always wins |
| 2 | `DRIVE_CODING_BASE` | Full URL (loopback API / MCP) |
| 3 | On-disk instance registry | Only if **exactly one** live instance remains |

`PORT` alone is **not** a discovery source for the CLI (a default of 4000 would silently
attach to the wrong process when multiple backends run).

- **Zero or multiple** registered instances → `agent …` exits non-zero and prints the list.
- **`drive-coding instances`** always exits 0 (even when empty) — it is the registry
  viewer, not an agent command.

Registry files live under `$XDG_RUNTIME_DIR/drive-coding/<port>.json` (fallback:
`~/.config/drive-coding/instances/`). A file is not proof of life — the CLI probes
`GET /api/health` with a short timeout and drops stale records.

Remote deployments (e.g. behind Cloudflare Access) have **no** auto-discovery — pass
`--base` explicitly.

## Environment variables injected into agents

When drive-coding spawns you or serves a surface prompt, these are the stable names:

| Variable | Use |
|---|---|
| `DRIVE_CODING_BASE` | Loopback API and MCP from this machine (preferred for HTTP/MCP calls) |
| `DC_BASE` | Legacy alias of the same loopback base |
| `DRIVE_CODING_AGENT_ID` | Your agent UUID (also sent as `X-Drive-Coding-Agent` on MCP) |
| `PUBLIC_BASE_URL` | User-facing HTTPS origin for links **the user clicks in a browser** |
| `DC_PARENT` | Parent agent id when you were opened as a child |

Rules of thumb:

- Call **`DRIVE_CODING_BASE`** (or `DC_BASE`) for `/api/…` and `/api/mcp` from the same
  host — no Cloudflare Access on loopback.
- Build markdown links for the **user** with **`PUBLIC_BASE_URL`** when it is set
  (tunnel, Pages, reverse proxy). If unset, do not invent a public origin.
- MCP endpoint: `{DRIVE_CODING_BASE}/api/mcp`
- File proxy pattern: `{origin}/api/fs/file?uri=<encodeURIComponent(file:///abs/path)>`

## Loopback base versus public origin

| | `DRIVE_CODING_BASE` | `PUBLIC_BASE_URL` |
|---|---|---|
| Audience | Your process, same machine | User's browser (phone/desktop) |
| Typical value | `http://127.0.0.1:4000` | `https://…` tunnel or deployed FE origin |
| Use for | API, MCP, server-side fetch | Clickable chat links, shared URLs |

The backend may also expose `publicBaseUrl` in MCP `session_whoami` / open responses
when configured.

## HTTP versus MCP versus CLI (connect angle)

- **HTTP**: you choose `{base}` from the table above, then call routes directly.
- **MCP**: same `{base}/api/mcp`; tools are listed in `20-session-lifecycle`.
- **CLI**: wraps HTTP with discovery; `open` injects `DRIVE_CODING_BASE` and `DC_BASE`
  into child processes.

## When connect fails

- Non-JSON or connection refused → wrong host/port or backend down — re-run discovery.
- 404 on `/api/health` → probably not a drive-coding server on that origin.
- CORS errors from a browser FE on another origin → backend needs that origin in
  `CORS_ORIGINS` (human config doc).

See `95-errors` for agent-specific 404/503 patterns once you have an agent id.
