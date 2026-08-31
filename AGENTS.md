# AGENTS.md — drive-coding

## Project

Voice-first hands-free interface for ACP-compatible CLI agents.
See the documentation map below. Start with `docs-for-llm/design-principles.md`.

## Where documentation lives — everything goes to `docs-for-llm/`, never to `docs/`

**Every brief, decision, walkthrough, plan and verification report is written to
`docs-for-llm/` and nowhere else.** Do not create a `docs/` directory in this repo.

`docs-for-llm/` is a **symlink to a separate private repo**, shared across projects:

```
docs-for-llm  ->  ~/Projects/docs-repo/drive-coding      (branch: master)
```

Two consequences that catch people out:

1. Writing there writes to *that* repo. It will **not** appear in `git status` here,
   and must be committed separately from `~/Projects/docs-repo`.
2. `.gitignore` blocks both `/docs/` (line 38) and `/docs-for-llm` (line 41), so a stray
   `docs/` is silently ignored rather than committed — you will not get a warning. Both
   patterns are **root-anchored**, so a `packages/<pkg>/docs/` would not be swept up.

> **This repo has been public since 2026-08-16.** Anything that does reach a tracked
> file is published. `docs/` is reserved for future **human-facing** documentation
> (getting-started, architecture, configuration, troubleshooting) in the public repo.
> Until that exists, nothing goes into `docs/`.

## Long-term planning

`docs-for-llm/roadmap.md` is the **master long-term roadmap** — vision, work tracks, and
milestones — and the single source of truth above the specific roadmaps
(provider / voice / frontend). **Any non-immediate planning belongs there:** before
proposing or starting work that is not an immediate task, check it against
`docs-for-llm/roadmap.md`, and record new long-term plans inside it (or in a sub-roadmap it
links to).

## Stack

- TypeScript (ESM only, no CommonJS)
- Bun (Slice 1) + Node 22.5+ (Slice 2+)
- Hono (HTTP/WS)
- SvelteKit + adapter-static (frontend)
- ArkType (schemas), neverthrow (Result)
- Vitest (tests), Biome (lint+format)
- bun workspaces (**bun-only since 2026-07-19** — the old `pnpm` choice was forced by a
  vite plugin that didn't support bun at the time; that constraint has since lifted and
  the vite/sveltekit build is verified under bun. `pnpm-lock.yaml` removed.)

## Structure

- `packages/core/` — pure logic, no IO. Tests TDD.
- `packages/backend/` — Hono + adapters. Integration tests.
- `packages/frontend/` — SvelteKit drive-first PWA, clean 5-layer architecture
  (view-models / actions / engines / adapters / routes). Has its own `AGENTS.md`
  with five golden rules. Built fresh in 2026-05 as `frontend-v2/`, renamed to
  `frontend/` after the legacy code was deleted.

The legacy `packages/frontend/` (accumulated chaos, 989-line route) was deleted from
this `dev` branch on 2026-05-28. It still exists on the `main` branch for reference
and can be checked out there if needed.

The current slice roadmap is `docs-for-llm/frontend/slices.md`.

## Conventions

- Strict TS: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- Functional core / imperative shell — pure in core, IO in backend.
- `Result<T, E>` (neverthrow) for fallible ops in core; throw only in shell.
- ArkType for all schemas — runtime validation + type inference.
- No `any` — use `unknown` + ArkType to refine.
- No deep `null` — `T | undefined` or Option pattern.

## Versioning — מספור גרסאות (טקס מיזוג)

> ה-bump קורה **בכל מיזוג ל-dev** (לא בכל commit) — חלק מטקס-המיזוג של מרדכי, אחרי calev GO + אישור משתמשת.

**מודל הגרסאות:**
- **`package.json` (root) = המספר הראשי** — הגרסה המוצגת ב-FE (`v{semver} ({git SHA})` בהגדרות). מקור-אמת יחיד לתצוגה.
- **`packages/release` = זהה ל-root תמיד** — זו החבילה המפורסמת ל-npm (`drive-coding`); מסונכרנת ל-root בכל bump.
- **`packages/{backend,core,frontend}` = גרסאות עצמאיות** — לכל אחת מונה משלה; עולה **רק כשהחבילה נגעה** במיזוג.

**בכל מיזוג, מרדכי מריץ** (אחרי ה-merge, לפני push):
```bash
# <level> לפי אופי ה-PR: patch (fix) · minor (feature) · major (breaking)
# [pkg...] = שמות החבילות תחת packages/ שנגעו במיזוג (backend/core/frontend)
node scripts/bump-version.mjs <level> [pkg...]
git commit -am "chore(release): vX.Y.Z"
git push origin dev
```
- ה-script מעלה את **root** ב-`<level>`, **מסנכרן `packages/release`** = root, **ומעלה כל `pkg` שנמסר** ב-`<level>`.
- רמת ה-bump: bug→`patch` · feature backward-compatible→`minor` · breaking (API/חוזה/התנהגות)→`major`.
- (`scripts/bump-version.mjs` נוצר ב-slice `cache-version`. עד שיוטמע — bump ידני באותו עיקרון.)

## Commands

```bash
bun install
bun run dev           # all packages
bun run test          # all tests
bun run typecheck
bun run lint          # Biome
bun run lint:i18n     # scripts/lint-no-hebrew-in-code.sh — blocks Hebrew in code
bun run format
bun run hooks:install # one-time: set core.hooksPath=.githooks (runs pre-commit lint)
```

> **Per-package commands** stay PM-agnostic via `node scripts/pm.mjs run-filter <pkg> <script>`
> (it detects bun from the user-agent), or directly as `bun run --filter <pkg> <script>`.
> The docs were swept to bun on 2026-08-16 — the only remaining `pnpm` mentions are in
> `scripts/pm.mjs` + its tests (where pnpm is one of four supported PMs) and in
> `package.json`'s `pnpm.overrides` key, which **bun does read** (it lands in `bun.lock`).

## Running & serving locally

⚠️ **HTTPS is mandatory** — the FE uses secure-context-only Web APIs
(`getUserMedia`, `AudioWorklet`). It works on `http://localhost` but NOT over plain
`http://` from any external host — use an HTTPS tunnel.

For the full build/serve flow (dev vs. production-like single-origin via
`FE_STATIC_DIR`), HTTPS tunneling, and Windows blockers/workarounds (onecli/bun,
opencode → use CLI=claude), see `docs-for-llm/running-locally.md`.

### Preview rules — showing the user a build to verify

> **Preview is a hard pre-merge gate.** מרדכי **never** merges anything before the
> **user has seen and OK'd a live preview** with their own eyes. calev GO (especially
> a static-only GO) is **not** a substitute — a green report never replaces the user
> looking at a running build. Every merge is preceded by: build → serve → user views →
> user approves → merge.

When an agent (calev runtime-gate, or any "look at this and confirm" moment) serves
the FE for the **user** to inspect, follow these rules:

1. **Preview = a production build, never HMR.** Do **not** hand the user the Vite dev
   server (`bun run dev` / HMR) as a "preview". Build first
   (`bun run --filter @drive-coding/frontend build`) and serve the built output
   (production-like single-origin via `FE_STATIC_DIR`, per `docs-for-llm/running-locally.md`).
   HMR is for the executor's own inner loop — it is **not** what we show the user.

2. **Where the agent runs decides the URL:**
   - **Agent runs on the user's own machine** → a `localhost` preview URL is enough
     (secure-context Web APIs work over `http://localhost`).
   - **Agent runs on a remote host** (e.g. the `cli-agents` box / `ufw`) → `localhost`
     is unreachable for the user, and plain `http://` breaks the secure-context APIs
     (`getUserMedia`, `AudioWorklet`). You **must** expose an **HTTPS tunnel** and give
     the user the tunnel URL. Use the **pico + `tuns`** HTTPS tunnel (see
     `docs-for-llm/running-locally.md` for the exact command). Never ask the user to open a
     plain-`http://` external address.

3. **Hand over a URL the user can actually open over HTTPS** — that is the deliverable
   of a preview, not a "it builds" report.

> **TODO (after `ui-session-polish` is merged):** make the preview target
> **environment-variable driven** (localhost vs. tunnel, and the tunnel URL) so the
> serve flow is config-driven instead of decided ad-hoc per run. Tracked as a
> follow-up; document the env var here once implemented.

## Git hooks

After clone, run `bun run hooks:install` once. It sets `core.hooksPath=.githooks/`
so `.githooks/pre-commit` runs the i18n lint before every commit. To skip a
specific commit (rare): `git commit --no-verify`.

## Worktrees

All worktrees live under `.worktrees/<name>/`. Branch names use the `slice/` prefix;
the worktree **directory omits it** (a slash would nest a subdir). Create one with:

```bash
git worktree add .worktrees/<name> -b slice/<name> dev   # branch: slice/<name> | dir: .worktrees/<name>
```

Cleanup after merge (worktrees pile up otherwise — we hit 34 at once):

```bash
bun run worktrees:prune                                    # dry-run vs. dev
bun run worktrees:prune -- --base integration/release-next # dry-run vs. an integration branch
bun run worktrees:prune -- --apply --delete-branches       # perform
```

**It is a dry-run unless you pass `--apply`.** It removes only worktrees that pass
all three checks: the ref is contained in a `--base`, the tree is clean, and **no
live process has its cwd inside** — that last one is the reason the script exists,
because `git worktree remove` does not check it. Removing a worktree out from under
a running BE takes its `FE_STATIC_DIR` with it. `--keep <name>` spares one by name.

On Windows there is no `/proc`, so the process check cannot run: `--apply` refuses
unless you also pass `--no-process-check`.

By hand, if you must: `git worktree remove .worktrees/<name>`,
`git branch -d slice/<name>`, `git worktree prune`.

Don't pollute the project root with worktree directories. The two long-lived
worktrees `dev/` and `main/` (at the project root) are the exception, not the rule.
Any new branch for a slice / bugfix / experiment goes under `.worktrees/`.

After `cd .worktrees/<name>`, run `bun install && bun run hooks:install`.

## Ports

- **Backend**: defaults to `4000`. Override with `PORT=<n>` env var.
- **Frontend (Vite dev)**: OS-assigned (no fixed port). Vite prints the chosen
  port at startup. The proxy to `/api`, `/proxy`, `/ws` defaults to BE on 4000,
  override with `BE_PORT=<n>` env var passed to Vite.

### Session-host ownership TTL

- **`HTTP_OWNER_TTL_MS`** — how long an HTTP owner may go without a liveness
  signal (`POST /api/agents/:id/presence` → `touchOwner`) before the backend
  **releases ownership**. Default `600000` (10 min). Expiry releases ownership
  and severs abandoned SSE streams — it does **not** destroy the session host,
  kill the agent, or reset `version`; the next connection is a continuation.
  Set it low (e.g. `HTTP_OWNER_TTL_MS=5000`) to exercise the path without a
  10-minute wait. The sweep interval itself is fixed at 30s.

### Running parallel worktrees

To run multiple BE+FE pairs simultaneously (e.g. two executor agents in two
worktrees), each pair gets its own port number. Convention: BE port 4000 for
the first worktree, 4001 for the second, etc.

```bash
# Worktree A — BE on 4000, FE Vite proxies → 4000 (default)
cd .worktrees/slice-X
PORT=4000 bun packages/backend/src/bin/drive-coding.ts --env-file ~/Projects/drive-coding/.env
bun run --filter @drive-coding/frontend dev
# (no env var needed — FE defaults to BE_PORT=4000)

# Worktree B — BE on 4001, FE Vite proxies → 4001
cd .worktrees/slice-Y
PORT=4001 bun packages/backend/src/bin/drive-coding.ts --env-file ~/Projects/drive-coding/.env
BE_PORT=4001 bun run --filter @drive-coding/frontend dev
```

Each worktree's FE will get a different OS-assigned Vite port — no conflict
on the FE side. Tunnels (if used) point at each FE's specific Vite port.

## Agent scopes — a guard rail, not a lock

Spawned agents carry a signed `DC_TOKEN` (env) / `X-Drive-Coding-Scope` (MCP header), and
write calls — `DELETE`/`PATCH /api/agents/:id`, `/reply`, `/rpc`, and the MCP `session_close`
/ `session_send` tools — are limited to the caller's own subtree. Anything outside it raises
a permission prompt on the caller's session. Entry point: `authorizeWrite()` in
`packages/backend/src/agent-scope.ts`.

> ⚠️ **This is not a security boundary, and it is not meant to become one.** A spawned agent
> runs as the same OS user as the backend, inherits its whole environment (`spawn-core.ts`
> builds the child env as `{ ...process.env }`, so `DC_MASTER_KEY` and `DC_SCOPE_SECRET` are
> readable by any child), can call the HTTP API with no header at all — `authorizeWrite()`
> returns `"allow"` when there is no token — and can edit the guard itself. The backend has
> no authentication of any kind.

What it *is* for: a confused agent pursuing an unrelated task should not close, prompt or
reconfigure a **stranger's** session by accident. That is the whole goal, and it is worth
having on its own.

**If you are reviewing this code: the bypasses above are known and accepted. Do not report
them as findings.** A real boundary needs a separate uid or container per agent, a secret
that never enters the child env, and an authenticated FE — a project, not a patch. Grep
`NOT_A_SECURITY_BOUNDARY` for the canonical statement in code.

## Backend needs API credentials — OneCLI is **one** way, not the only way

> ⛔ **Corrected 2026-08-26.** This section used to say *"Backend MUST run through
> OneCLI"* and *"do NOT start the BE with a plain `bun` command"*. **That is wrong,
> and it cost real time**: an agent went hunting for `onecli` — which **is not
> installed on this machine** — instead of using the mechanism that actually works.

The proxies at `/proxy/elevenlabs/*` and `/proxy/google/*` need
`ELEVENLABS_API_KEY` and `GEMINI_API_KEY` **in the environment**. *How* they get
there is open — the BE only ever reads `process.env`.

```bash
# ✅ env file — what the live deployment actually does
bun packages/backend/src/bin/drive-coding.ts --env-file ~/Projects/drive-coding/.env

# ✅ config file — voice.elevenLabsKey / voice.geminiKey in config.jsonc.
#    load-config maps them to ENV via buildEnvPatch, so child CLIs inherit them too.
bun packages/backend/src/bin/drive-coding.ts --config ~/.config/drive-coding/config.jsonc

# ✅ plain environment variables
ELEVENLABS_API_KEY=… GEMINI_API_KEY=… bun packages/backend/src/bin/drive-coding.ts

# ✅ OneCLI — still valid **on a machine where it is installed**
onecli run --agent voice-acp -- bun --watch src/server.ts
```

**Precedence** (`packages/backend/src/config/load-config.ts`):
config file < `process.env` < CLI flags. `--env-file` is applied first and is
**non-overriding** — a real env var beats it.

**On this machine (srv1812097)**: both deployments run under systemd
(`drive-coding-{main,dev}.service`) and use **`--env-file`**. `onecli` is absent.

### Running BE with CORS for deployed CF Pages FE

When connecting the deployed `https://drive-coding.pages.dev` FE to a local BE,
include the Pages origin in `CORS_ORIGINS`:

```bash
# Local BE serving both local and CF Pages FE (consistent with deploy/systemd/drive-coding-main.service)
CORS_ORIGINS="https://drive-coding.pages.dev,http://localhost:4000" \
  PORT=4000 bun packages/backend/src/bin/drive-coding.ts --env-file ~/Projects/drive-coding/.env
```

See `docs-for-llm/deploy-cf-pages.md` for full deploy instructions and known limitations
(mixed-content + Private Network Access).

Whichever mechanism you use, the BE needs the same two keys — `ELEVENLABS_API_KEY`
for `api.elevenlabs.io` and `GEMINI_API_KEY` for `generativelanguage.googleapis.com`.
Anthropic credentials are **deliberately not** injected (see
`~/.config/opencode/learnings.md` 2026-05-14, Anthropic balance drain).
Where OneCLI *is* installed, the `voice-acp` agent supplies those two as
`xi-api-key` / `x-goog-api-key`.

How to tell the BE is missing its keys: the FE shows `TTS failed: 401`
and the BE log shows `proxy upstream non-2xx` warnings (since the
observability commit `a76e7c1`).

## Wire tracing & recording (debug)

Two passive taps on the ACP pipe (`packages/backend/src/acp/connection-registry.ts`), both
**off by default**, neither alters the stream (each runs *after* the send/write).
Both live in `connection-registry` (`onFrame`) — **always-active for the full child lifetime**, surviving
FE disconnect/reconnect cycles (unlike the previous `ws-agent` location).
`bridge-manager.ts` was removed; `server.ts` notes the registry replaced that singleton.

- **`LOG_WIRE=acp`** — live wire summary to the BE stdout via pino (slice-wire-observability-bridge).
  Namespace: `backend.acp.wire.*` (CLI↔BE layer).
  `debug` → `{dir,type,id}`; `trace` → full decoded frame. Best for watching traffic
  inline with the rest of the BE log timeline.
- **`WIRE_RECORD=1`** — records **every raw frame** to
  `~/.config/drive-coding/wire-recordings/<agentId>-<ts>.jsonl` — one `{ts,dir,raw}` line
  per frame, a clean file per child lifetime (not per WS connection — slice wire-observability-bridge).
  Best for offline analysis of anomalies (empty chunks, duplicate ids) with `jq`. Works live too:
  `tail -f ~/.config/drive-coding/wire-recordings/*.jsonl | jq` — after daily compression,
  almost every `.jsonl` left in the directory is the live recording or a fresh one since
  the timer last ran, so this tail is more precise than before, not less.

### Compression (daily maintenance)

A daily timer at **05:15** runs `compress-wire-recordings.mjs --apply`: every **released**
`.jsonl` is compressed to `.jsonl.zst` (~25× smaller), released zero-byte files are deleted,
and **no retention caps** are enabled by default. The **live** recording stays an uncompressed
`.jsonl` — `tail -f` above keeps working unchanged.

An open file is **never** compressed: `zstd --rm` on a file still held by a process loses
frames silently **and frees no space** (the fd keeps the inode). Detection uses `/proc/*/fd`,
**not mtime** — the recorder is "always-active for the full child lifetime", so a file can
sit open for days with no writes and mtime would mislead exactly on the large ones.

For **historical** analysis across both compressed and live files:

```bash
# live tail — after compression, almost every .jsonl left is live or fresh since the timer
tail -f ~/.config/drive-coding/wire-recordings/*.jsonl | jq
# full history — -f passes through uncompressed files too. e.g. every thought-chunk text
# (we found claude sends them ALL empty — an upstream ACP-adapter issue, BE is transparent):
zstdcat -f ~/.config/drive-coding/wire-recordings/*.jsonl* \
  | jq -r 'select(.raw|fromjson|.params.update.sessionUpdate=="agent_thought_chunk") | (.raw|fromjson|.params.update.content.text)'
# fast grep on mixed archive
zstdgrep -h '"sessionUpdate":"agent_thought_chunk"' ~/.config/drive-coding/wire-recordings/*.jsonl*
```

The timer is **not installed automatically**. To install:

```bash
cp deploy/systemd/wire-rec-compress.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now wire-rec-compress.timer
```

Manual run (dry-run by default; `-- --apply` to perform):

```bash
bun run wire-rec:compress          # dry-run
bun run wire-rec:compress -- --apply
```

```bash
# record a session — Windows: bun direct (onecli can't spawn bun; TTS proxy unneeded here)
cd packages/backend
WIRE_RECORD=1 PORT=4000 bun src/server.ts
```

The recordings live outside the repo, so they never enter git.

## What NOT to do

- No secrets in code (`.env` is gitignored)
- No CommonJS (`require`, `module.exports`)
- No adapters in `core/` — they live in `backend/adapters/`
- No browser globals in `core/`

## Documentation map — which doc answers which question

This file is a **map**. It tells you *which* doc to open; the docs themselves hold
the detail. Open the right one before writing code.

| If you need… | Open | Status |
|--------------|------|--------|
Paths below starting with `docs-for-llm/` live in the **private docs-repo** (see the
section at the top) — they are not files in this repo, and are unreachable from a
public clone. Paths under `packages/` are real files here.

| If you need… | Open | Status |
|--------------|------|--------|
| **Code design rules** — layers, what an "engine" is, when to use `$effect` vs a method, state-machine pattern, primary-vs-derived VMs | `docs-for-llm/design-principles.md` §1-5 | **canonical** |
| **The 50 architectural decisions (D1-D50)** | `docs-for-llm/design-principles.md` §6 | **canonical** |
| **FE five golden rules** (the short, injected version) | `packages/frontend/AGENTS.md` | canonical (design-principles expands it) |
| **UX spec** — drive-first, colors, mic states, bubbles, car mode | `docs-for-llm/frontend-spec.md` | canonical |
| **FE↔BE protocol, schemas, ports** | `docs-for-llm/vnext-spec.md` | canonical (§8.5 slices is OBSOLETE) |
| **The current slice roadmap** | `docs-for-llm/frontend/slices.md` | **source of truth** for slice order |
| **Additive design** for shared files (parallel agent work) | `docs-for-llm/conventions/parallel-safe-code.md` | canonical — read BEFORE touching `context.ts`, `+layout.svelte`, `i18n/keys.ts`, `chat/+page.svelte` |
| **Per-slice rationale** (why the code looks the way it does) | `docs-for-llm/decisions/voice-acp.md` | living log (written by מרדכי) |
| **How to write a slice plan** (handoff to executor) | `docs-for-llm/plans/README.md` | canonical |
| **Planning history** — *how* we reached D1-D50, mental model, competitor/library research | `docs-for-llm/vnext-planning.md`, `docs-for-llm/vnext-research.md` | **historical** (not maintained) |

> **Reading order for a new code task:** `design-principles.md` (rules) →
> `frontend/AGENTS.md` (FE golden rules) → the relevant spec (`frontend-spec.md` §X)
> → `parallel-safe-code.md` if you touch a shared file.

## עבודה עם מרדכי (planner)

If you hit any of these — **stop and ask מרדכי via the parent task**:
- Architectural decision not covered by D1-D50 (`design-principles.md §6`)
- Spec ambiguity that affects > 50 lines of code
- A library/tool failing in a way that suggests our stack choice was wrong
- A test infrastructure gap

Otherwise: decide reasonably, document in commit message, continue.
