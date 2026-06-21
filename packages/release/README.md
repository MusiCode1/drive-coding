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

Configuration can be passed as **CLI flags** or **environment variables**.
Flags take precedence over environment variables; environment variables take
precedence over defaults.

### CLI flags

```
drive-coding [options]

  -p, --port <n>            Port to listen on            (env: PORT, default: 4000)
      --opencode-bin <bin>  Agent binary to look for     (env: OPENCODE_BIN, default: opencode)
      --fe-static-dir <dir> Override served web-UI dir   (env: FE_STATIC_DIR)
      --cors-origins <list> Comma-separated CORS origins  (env: CORS_ORIGINS)
  -h, --help                Show this help and exit
  -V, --version             Show version and exit
```

```bash
drive-coding --port 4100
drive-coding --opencode-bin /opt/opencode/bin/opencode
drive-coding --help
drive-coding --version
```

### Environment variables

| Variable | What | Default |
|----------|------|---------|
| `PORT` | Port the server listens on | `4000` |
| `OPENCODE_BIN` | Path/name of the agent binary to look for | `opencode` |
| `FE_STATIC_DIR` | Override the served web-UI directory (rarely needed) | bundled `frontend-dist` |
| `CORS_ORIGINS` | Comma-separated list of allowed CORS origins | same origin only |

```bash
PORT=4100 drive-coding                 # custom port (env var)
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
