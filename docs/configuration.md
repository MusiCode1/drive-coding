# Configuration — environment variables

Every environment variable drive-coding reads, what it does, and the gotchas.

Written for two audiences: **people** setting the app up, and **coding agents**
working in this repo. Nothing here is secret — API keys are named, never valued.

> **Nothing is required.** With no environment at all, the backend listens on
> `127.0.0.1:4000` and serves the API. You only set variables to change that.

---

## Quick start

```bash
bun install
bun run dev                       # everything, defaults
PORT=4100 bun run dev             # backend on a different port
```

Serving a production build from a single origin (what a deployment looks like):

```bash
bun run --filter @drive-coding/frontend build
cd packages/backend
FE_STATIC_DIR=../frontend/build PORT=4000 bun src/server.ts
```

⚠️ **The browser needs a secure context.** `getUserMedia` and `AudioWorklet`
(microphone, audio playback) only work over `https://` or on `http://localhost`.
Reaching the app at `http://<some-host>:4000` from another machine will load the
page but break voice. Put it behind HTTPS — a tunnel is enough for testing.

---

## Server

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `4000` | Backend HTTP/WS port. |
| `DRIVE_CODING_HOST` | `127.0.0.1` | Bind address. Set to `0.0.0.0` to accept connections from other machines. |
| `FE_STATIC_DIR` | *(unset)* | Directory of the built frontend. When set, the backend serves the UI **and** the API on one origin. Unset = API only. |
| `CORS_ORIGINS` | *(unset)* | Comma-separated allowed origins. Only needed when the UI is served from a **different** origin than the API. |
| `DRIVE_CODING_HTTPS` | *(unset)* | TLS material as JSON, to serve HTTPS directly. Most setups terminate TLS at a tunnel or reverse proxy instead and leave this alone. |

> 🔴 **The backend has no authentication of its own.** This is deliberate: access
> control is expected to live in front of it (Cloudflare Access, a VPN, or simply
> binding to localhost). **Do not bind to `0.0.0.0` on a public network** unless
> something else is authenticating requests — anyone who can reach the port can
> start a coding agent with full access to your files.

---

## Choosing and locating CLI agents

drive-coding launches CLI agents as child processes. Which binary, and with which
arguments, comes from a built-in table that you can extend or override.

| Variable | Default | What it does |
|---|---|---|
| `CLI_SPECS_FILE` | `~/.config/drive-coding/cli-specs.jsonc` | Path to the overrides file (JSONC — comments allowed). |
| `CLI_SPECS_JSON` | *(unset)* | Inline JSON, merged **over** the file per key. Handy for containers. |
| `OPENCODE_BIN` / `OPENCODE_ARGS` | *(unset)* | Legacy single-CLI override, predating the specs file. Prefer the file. |
| `CLAUDE_CODE_EXECUTABLE` | *(unset)* | Path to the `claude` binary when it is not on `PATH`. |

A minimal override file:

```jsonc
{
  // Top-level keys starting with "$" are metadata, not CLI names.
  "$schema": "./cli-specs.schema.json",

  "my-agent": {
    "bin": "/opt/my-agent/bin/agent",
    "args": ["--acp"],
    "displayName": "My Agent"
  }
}
```

Adding a key here makes the agent appear in the UI dropdown. Overriding an
existing key changes how that agent is launched.

> ⚠️ **`env` in a spec reaches the CLI, never the in-process bridge.** Two agents
> (claude, codex) are hosted inside the backend process rather than spawned, and
> they read the backend's own environment. Per-agent environment for those is not
> supported today.

---

## Logging and diagnostics

| Variable | Default | What it does |
|---|---|---|
| `LOG_LEVEL` | `info` | `trace` · `debug` · `info` · `warn` · `error` · `silent`. |
| `LOG_NS` | `*` | Comma-separated namespace filter. `backend.*` includes a subtree; `-noisy.x` excludes (exclusion wins). |
| `LOG_FORMAT` | `both` | `pretty` (stderr, human) · `json` (stdout, machine) · `both`. |
| `LOG_WIRE` | *(unset)* | Full ACP frame tracing. `acp` · `ws` · `1` (both). |
| `WIRE_RECORD` | *(unset)* | `1` records every raw frame to `~/.config/drive-coding/wire-recordings/<agentId>-<ts>.jsonl`. Outside the repo, so it never enters git. |
| `HOTPATH_SLOW_MS` | `50` | Log a warning when a hot-path operation exceeds this many milliseconds. |
| `RSS_BUDGET_MB` | `1500` (`CONFIG_SPECS`) | Memory ceiling above which the backend starts shedding load. |
| `HTTP_OWNER_TTL_MS` | `600000` (`CONFIG_SPECS`) | How long an HTTP owner may go without a liveness signal (`POST /api/agents/:id/presence`) before the backend **releases ownership**. Expiry releases ownership and severs abandoned SSE streams — it does **not** destroy the session host, kill the agent, or reset `version`; the next connection is a continuation. Lowering it (e.g. `5000`) is a **debugging aid**: the FE `LIVENESS_FRESH_MS` imports the same catalog default at build time, so a live env override here will make the UI's "connected" indicator lag behind the backend. |

### Reading a wire recording

```bash
WIRE_RECORD=1 PORT=4000 bun src/server.ts
# …reproduce the problem, then:
jq -r 'select(.raw|fromjson|.method=="session/update")' ~/.config/drive-coding/wire-recordings/*.jsonl
```

### 🔴 A trap that cost us hours

`LOG_WIRE` used to **replace** `LOG_NS` rather than add to it. Turning on wire
tracing therefore silenced every other namespace — so a real spawn failure left
no explanation anywhere, and the switch meant to give you eyes took them away.

Fixed: `LOG_WIRE` now traces the wire namespaces **in addition to** normal
logging, and no longer forces the global level to `trace`.

**The general lesson, worth keeping:** after adding a diagnostic log line, check
that it actually prints. A log line that is silently dropped is worse than no log
line, because it reads as "nothing happened".

---

## Frontend build

Read at **build time** by Vite, not at runtime.

| Variable | Default | What it does |
|---|---|---|
| `FE_ENV` | `prod` | `dev` · `preview` · `prod`. Affects defaults and the build banner. |
| `FE_STATIC_DIR` | *(see above)* | Where the backend looks for the built UI. |
| `FE_BUILD_OUT` | `build` | Output directory for the build. |
| `FE_TITLE` / `PUBLIC_APP_TITLE` | `Drive Coding` | Document title. |
| `FE_PREVIEW_LABEL` | *(unset)* | Badge text, to tell one preview from another. |
| `FE_SOURCEMAP` | *(unset)* | `1` emits source maps. |
| `BE_PORT` | `4000` | Which backend the Vite dev server proxies to. Dev only. |
| `FE_SESSION_TRANSPORT` / `PUBLIC_SESSION_TRANSPORT` | *(unset)* | Default transport, `ws` or `http`. See below. |

### Transports — `ws` vs `http`

Two ways the browser can talk to a running agent:

- **`ws`** — the browser is the ACP client and the backend is a transparent pipe.
  Session state lives in the browser.
- **`http`** — the backend holds the session state and streams updates over SSE.
  The browser can disconnect and rejoin without losing anything.

Per-tab override, no rebuild needed:

```
https://your-host/chat?sessionTransport=http
```

The value is stored in `sessionStorage` and applies to the **next** connection;
a live session keeps the transport it started with.

---

## Provider credentials

drive-coding does not manage provider logins. Each CLI agent handles its own
authentication — you sign in with that CLI, in a terminal, and drive-coding
reuses the session it stored.

> 🔴 **Interactive sign-in cannot complete inside drive-coding.** Agents are
> launched headless: no terminal to type into, no browser to open. If an agent
> reports that it needs authentication, sign in with that CLI directly first, then
> come back. Since the 10-second `authenticate` timeout, this surfaces as a clear
> message; before it, the session simply hung forever with a blank screen.

Two keys power voice features (text-to-speech). They belong in a **dedicated
secrets file**, not in the main config:

| File | Default path | Format |
|---|---|---|
| `secrets.json` | `~/.config/drive-coding/secrets.json` | Flat JSON object |

```json
{
  "elevenLabsKey": "your-elevenlabs-key",
  "geminiKey": "your-gemini-key"
}
```

Both fields are optional — omit a key if you do not use that provider.

### Precedence (secrets only)

From lowest to highest priority:

1. `secrets.json` (or `--secrets <path>`)
2. Environment variable
3. CLI flag (`--elevenlabs-key`, `--gemini-key`)

A partial CLI flag **does not** drop a sibling secret from a higher layer.
For example, `--elevenlabs-key` with `GEMINI_API_KEY` in the environment keeps
**both** keys.

### Environment variables (alternative)

| Variable | Used for |
|---|---|
| `ELEVENLABS_API_KEY` | Text-to-speech via ElevenLabs. |
| `GEMINI_API_KEY` | Text-to-speech via Gemini. |

These are the same values as `elevenLabsKey` / `geminiKey` in `secrets.json`.
The backend writes the winning values to `process.env` for child processes.

### 🔴 Secrets in the config file are rejected

Putting `voice`, `elevenLabsKey`, or `geminiKey` in `config.jsonc` (or
`--config-json`) causes a **startup failure** with an explicit error — not a
silent 401 later. Move the key to `secrets.json` or use an env var / CLI flag.

Without the keys, text chat works and speech does not.

---

## Filesystem access

| Variable | Default | What it does |
|---|---|---|
| `FS_BROWSE_ALLOWED_BASE` | *(unset)* | Restricts the folder picker to a subtree. Unset = the picker can browse anywhere the backend user can read. |

Worth setting on a shared or exposed machine.

---

## Testing and scripts

| Variable | What it does |
|---|---|
| `RUN_LIVE` | `1` enables tests that spawn real CLI agents. Off by default — they are slow and consume provider quota. |
| `PROXY_PORT` · `SINK_PORT` | Ports for the debug proxy / sinkhole scripts under `scripts/`. |
| `PROMPT_INJECTOR_TEXT` · `PROMPT_INJECTOR_DEBUG_PATH` | System-prompt injection experiments. |
| `CLAUDE_WRAPPER_REAL_CLAUDE` · `CLAUDE_WRAPPER_LOG_DIR` | Wrapper that logs what the `claude` binary receives. |
| `BUN_BIN` | Explicit Bun path for the packaging scripts. |

---

## Troubleshooting

**The session never opens; the screen stays blank.**
Look for `session-host creation failed (ACP handshake)` in the backend log — it
names the CLI, the working directory, and the reason. The two common causes are
an agent that is not signed in, and a binary that could not be launched.

**The agent shows "typing" forever and never answers.**
After 90 seconds of complete silence a notice appears. The turn is *not*
cancelled automatically — a genuine answer can take minutes of quiet thinking, so
the decision to cancel stays yours. If it never recovers, check that agent's own
log: some agents hit a provider error (out of quota, for instance) and fail to
report it over the protocol at all.

**Voice does nothing.**
Almost always a secure-context problem — see the warning at the top. Confirm the
page is on `https://` or `localhost`, then check that the relevant API key is set.

**An agent is missing from the dropdown.**
`GET /api/cli-availability` shows every known agent, whether its binary was
found, and where. If it says `found: false`, the binary is not on `PATH` and has
no override in the specs file.

**Changed the specs file and nothing happened.**
It is read at startup. Restart the backend.
