# drive-coding

**English** · [עברית](./README.he.md)

AI-powered coding assistant — a single command launches the backend server and
serves the web UI from one origin.

## Quick start

```bash
bunx drive-coding
```

This starts the server on **http://localhost:4000** and serves the web UI from
the same origin. Open the printed URL in your browser.

> **Requires [Bun](https://bun.sh).** The binary runs under Bun
> (`#!/usr/bin/env bun`). Install Bun with `curl -fsSL https://bun.sh/install | bash`.

To install once and run repeatedly:

```bash
bun add -g drive-coding
drive-coding
```

## Requirements

- **Bun** ≥ 1.3 — the runtime.
- **An AI agent CLI** for actual coding sessions. By default `drive-coding` looks
  for [`opencode`](https://opencode.ai) on your `PATH`. The server still starts
  without it (you'll see a warning) — handy for browsing the UI — but agent
  sessions need a reachable agent.

## Configuration

All configuration is via environment variables (explicit values always win over
defaults):

| Variable | What | Default |
|----------|------|---------|
| `PORT` | Port the server listens on | `4000` |
| `OPENCODE_BIN` | Path/name of the agent binary to look for | `opencode` |
| `FE_STATIC_DIR` | Override the served web-UI directory (rarely needed) | bundled `frontend-dist` |

```bash
PORT=4100 drive-coding                 # custom port
OPENCODE_BIN=/opt/opencode/bin/opencode drive-coding
```

## What's inside

A single self-contained package:

- the backend server (Hono) — REST API + WebSocket, bundled into one file;
- the prebuilt web UI, served from the same origin (no second process, no CORS);
- the `prompt-injector` plugin, loaded by the agent process at runtime.

No monorepo, no workspace, no build step on your side — everything ships in the
package.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Warning: agent binary "opencode" not found in PATH` | Install opencode, or set `OPENCODE_BIN` to your agent. The server still starts. |
| `command not found: bunx` | Install Bun (`curl -fsSL https://bun.sh/install \| bash`), then restart your shell. |
| Port already in use | Set `PORT` to a free port, e.g. `PORT=4100 drive-coding`. |
| The page is blank / 404 on `/` | You likely set `FE_STATIC_DIR` to an empty or wrong path — unset it to use the bundled UI. |

## License

MIT
