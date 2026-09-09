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
| `DC_DEPLOYMENT` | *(the port)* | Name of this deployment. Its agents — sockets, metadata and the registry snapshot — live in one directory under that name. |
| `DC_DEPLOYMENT_DIR` | *(derived)* | Overrides that directory outright. Point a second backend at an existing one to hand its agents over. |
| `AGENTS_STORE_FILE` | *(inside the deployment dir)* | Overrides just the snapshot path. |
| `AGENT_SIDECAR` | *(unset)* | Comma-separated cliKinds to run as **sidecars** — separate processes that survive a restart of this one. See below. Unset = nothing changes. |
| `SHUTDOWN_KILLS_AGENTS` | *(unset)* | `1` makes a shutdown stop every sidecar too. Unset leaves them running (an interactive Ctrl+C asks). |

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
| `ELICITATION_TIMEOUT_MS` | *(unset — no timeout)* | How long an elicitation (a question the agent asked, e.g. `AskUserQuestion`) may stay unanswered before it auto-**declines**. Unset means it waits indefinitely, which is the point: an unanswered question must not answer itself. Accepts `never` / `off` / `0` as explicit synonyms. On expiry the agent receives `decline` — empty answers, turn continues — not `cancel`, which would abort the tool call. ⚠️ Values above `2147483647` (and `Infinity`) are **rejected and treated as no timeout**: Node collapses a larger `setTimeout` delay to 1ms, so such a value would cancel the request instantly rather than never. Also a `config.jsonc` leaf (`elicitationTimeoutMs`). |
| `PERMISSION_TIMEOUT_MS` | *(unset — no timeout)* | Same, for permission prompts (tool approvals, plan approvals). On expiry the request resolves as `cancelled`. Same ceiling and same synonyms. Leaf: `permissionTimeoutMs`. |

### Reloading configuration without a restart

Editing `config.jsonc` or `secrets.json` takes effect on a running backend —
no restart, no dropped agents. Two triggers, same path:

```bash
# 1. Just edit. A watcher on ~/.config/drive-coding/ picks it up (debounced
#    150ms; atomic saves via write-temp+rename are handled).
$EDITOR ~/.config/drive-coding/secrets.json
#    ⚠️ The watcher only covers the directory holding cli-specs.jsonc. If you
#    started the backend with --config or --secrets pointing elsewhere — or set
#    CLI_SPECS_FILE to another directory — edits there are NOT noticed, and the
#    endpoint below is the only trigger.

# 2. Or ask explicitly:
curl -X POST http://127.0.0.1:4002/api/reload-config
```

**What reloads** — only values verified to be re-read on every use *and*
present in `CONFIG_SPECS`/`SECRET_SPECS`: `ELEVENLABS_API_KEY` and
`GEMINI_API_KEY` (`resolveProviderAuth` is pure and called per request),
`OPENCODE_BIN` (per spawn), `ELICITATION_TIMEOUT_MS` /
`PERMISSION_TIMEOUT_MS` (per session host), `LOG_LEVEL` / `LOG_NS` /
`LOG_FORMAT` (the reload re-runs `initLogger`), and `CLI_SPECS_JSON`.

`OPENCODE_ARGS` and `LOG_WIRE` are **not** reloadable despite being read
per use: they have no `CONFIG_SPECS` entry, so no config file can produce them.

**Deleting** a key from the file is honoured too — it reverts to whatever the
environment provided at boot, or is unset if nothing did. That matters for
secrets: removing a leaked key from `secrets.json` actually stops it being used.

**What does not.** `PORT`, `DRIVE_CODING_HOST`, `DRIVE_CODING_HTTPS`,
`CORS_ORIGINS`, `FE_STATIC_DIR`, `RSS_BUDGET_MB`, `HOTPATH_SLOW_MS`,
`HTTP_OWNER_TTL_MS`, `WIRE_RECORD`, `FS_BROWSE_ALLOWED_BASE`,
`AGENTS_STORE_FILE`, `AGENT_SIDECAR` — all baked into
the HTTP server at boot. Changing one logs `restart required to apply` and is
**not** applied. Deliberately loud: a config change that appears to work and
doesn't is worse than one that refuses.

⚠️ **A process that is already running keeps the environment it started with.**
Agents get `{ ...process.env }` at spawn time, and there is no way to update a
live process's environment. New agents pick up the new value; agents already
running do not. If you rotate a key to fix a broken agent, that agent still has
to be restarted — only the ones you start afterwards get the new key.

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


## The agent registry snapshot

Every agent row is mirrored to `AGENTS_STORE_FILE` on each create, update and
delete, written whole and replaced by `rename(2)` so a reader never sees half a
snapshot. Runtime fields — `title`, and the per-request enrichment (`pid`,
`attached`, `busy`, `lastSeenAt`) — are stripped before writing: they describe a
live process, and restoring them would state something about a process that is
gone.

🔴 **The file is written but not yet trusted.** On boot the rows are read and
then handed to an *adoption* function, which decides which of them may re-enter
the live registry. The default adopts **none**, so `GET /api/agents` after a
restart is empty — exactly as before this existed. That is deliberate and not a
placeholder: today every CLI dies with the backend, so a row read back from disk
describes a process that no longer exists.

Two independent reasons the process dies, both of which the sidecar work has to
address before adoption can be turned on:

1. `KillMode=control-group` in the systemd unit — `systemctl restart` sends
   SIGTERM to **every** process in the unit's cgroup, not just the main one.
   `detached: true` at spawn creates a new process *group*, which does not help.
2. The child's stdin/stdout are pipes to the backend, and they die with it.

When agents do outlive the backend, adoption becomes a probe over the live
sockets and this same file is what restores their identity — including the
`id` in the chat URL, which is why `POST /api/agents` accepts an explicit `id`.


## Agents that survive a restart — `AGENT_SIDECAR`

Normally a CLI agent is a child of the backend and dies with it. Set
`AGENT_SIDECAR=cursor` and agents of that kind are launched instead as their own
transient systemd unit, listening on a Unix socket:

```
backend ──connect──▶ $XDG_RUNTIME_DIR/drive-coding/deployments/<name>/
                         agents.json        the registry snapshot
                         <agentId>.sock  ──▶ [ sidecar, own unit ] ──▶ cursor
                         <agentId>.json     what that sidecar says it is
```

Restart the backend and the agents keep running; the new backend finds the
sockets, adopts the matching rows from `AGENTS_STORE_FILE`, re-attaches, and
re-seeds their ACP session ids so the transcripts come back too.

Measured on a deployment carrying the same `KillMode=control-group` as the real
ones:

```
before   backend MainPID 2547046 · 3 agent units at 2547234 / 2547260 / 2547302
         agent 1 told "remember the word PERSIMMON"
restart  systemctl --user restart drive-coding-sidecar
after    backend MainPID 2548618 — replaced
         all three agent units: same MainPIDs, still active
         same sessionId, same 3-message transcript
         "What word did I ask you to remember?" → "PERSIMMON"
```

**Off by default.** Only stdio-ACP CLIs can be hosted this way — currently
`cursor`, `opencode`, `gemini`. `claude` and `codex` run as in-process adapters
and are rejected with a warning if listed.

### Why a systemd unit and not just a detached child

```
$ systemctl --user show drive-coding-edge.service -p KillMode
KillMode=control-group
```

systemd SIGTERMs **every process in the unit's cgroup** on restart. `detached:
true` at spawn opens a new process *group*, which is a different thing and does
not help. Measured with a stand-in backend carrying the same `KillMode`:

| | before restart | after restart |
|---|---|---|
| launched via `systemd-run` | pid 2479811 | **pid 2479811** — same process |
| spawned as a detached child | pid 2479822 | pid 2480296 — killed, replaced |

A transient unit lands in `app.slice` as a *sibling* of the backend, out of
reach of its cgroup kill.

⚠️ **A transient unit does not inherit the caller's environment.** Measured: 19
variables and a PATH without `~/.bun/bin` or `~/.local/bin`. The launcher
therefore uses an absolute interpreter path and forwards a named allowlist
(`PATH`, `CLI_SPECS_FILE`, `CLI_SPECS_JSON`, `OPENCODE_BIN`, `LOG_*`, …).

### What this does not do yet

- **Output emitted while no backend is attached is dropped, not buffered.** A
  turn producing text in the window between one backend dying and the next
  connecting loses that text.
- **The conversation comes back, but only if the agent had one.** The row's
  `acpSessionId` is persisted and re-seeded at boot, so re-opening the agent
  takes `session/load` rather than `session/new`. Measured end to end: a restart,
  then the same session id, the same transcript, and the agent still answering
  from context set before the restart. An agent that never opened a session
  comes back as `starting` — the process is real, the session is not yet.
- **Windows is not covered.** Unix sockets only.

### Ending an agent for good

Closing a connection only *detaches* from a sidecar — which is what lets a
restart keep agents alive. `DELETE /api/agents/:id` (and MCP `session_close`,
and `closeOnTurnEnd`) stop the unit as well. To do it by hand:

```bash
systemctl --user stop dc-agent-<agentId>
```


## Moving a deployment, or handing its agents to another one

Everything about a deployment's agents lives in one directory, named by
`DC_DEPLOYMENT` rather than keyed by the port.

🔴 It used to be the port, and that was wrong in a specific way: the port is
exactly what changes when you move a deployment. Bring the same backend up on a
different port and every running agent became an orphan instantly — still alive,
still listening, invisible to the backend that had just been looking for them in
a directory that was never populated.

A name does not change when the port does:

```bash
# same agents, whatever port this ends up on
Environment=DC_DEPLOYMENT=edge
```

To hand agents from one deployment to another — the migration case — point the
incoming backend at the outgoing one's directory:

```bash
DC_DEPLOYMENT_DIR=$XDG_RUNTIME_DIR/drive-coding/deployments/sidecar
```

It adopts every live sidecar it finds there, with sessions intact.

⚠️ **One at a time.** Two backends on one directory both adopt the same agents,
and client-wins means the last one to send a frame owns the session. This is for
a handover with the outgoing side stopped, not for running a pair.

⚠️ **The gap is not free.** Between stopping one backend and the next one
attaching, output from a running turn is dropped rather than buffered. On a
deployment whose `ExecStartPre` runs `bun install` and an FE build, that window
is 45–60 seconds. Some of it comes back: `session/load` replays the transcript
on CLIs that support it (claude does), while others reattach without replay.
