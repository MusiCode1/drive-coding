# AGENTS.md — drive-coding

## Project

Voice-first hands-free interface for ACP-compatible CLI agents.
See the documentation map below. Start with `docs/design-principles.md`.

## Long-term planning

`docs/roadmap.md` is the **master long-term roadmap** — vision, work tracks, and
milestones — and the single source of truth above the specific roadmaps
(provider / voice / frontend). **Any non-immediate planning belongs there:** before
proposing or starting work that is not an immediate task, check it against
`docs/roadmap.md`, and record new long-term plans inside it (or in a sub-roadmap it
links to).

## Stack

- TypeScript (ESM only, no CommonJS)
- Bun (Slice 1) + Node 22.5+ (Slice 2+)
- Hono (HTTP/WS)
- SvelteKit + adapter-static (frontend)
- ArkType (schemas), neverthrow (Result)
- Vitest (tests), Biome (lint+format)
- pnpm workspaces

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

The current slice roadmap is `packages/frontend/docs/slices.md`.

## Conventions

- Strict TS: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- Functional core / imperative shell — pure in core, IO in backend.
- `Result<T, E>` (neverthrow) for fallible ops in core; throw only in shell.
- ArkType for all schemas — runtime validation + type inference.
- No `any` — use `unknown` + ArkType to refine.
- No deep `null` — `T | undefined` or Option pattern.

## Commands

```bash
pnpm install
pnpm dev              # all packages
pnpm test             # all tests
pnpm typecheck
pnpm lint             # Biome
pnpm lint:i18n        # scripts/lint-no-hebrew-in-code.sh — blocks Hebrew in code
pnpm format
pnpm hooks:install    # one-time: set core.hooksPath=.githooks (runs pre-commit lint)
```

## Running & serving locally

⚠️ **HTTPS is mandatory** — the FE uses secure-context-only Web APIs
(`getUserMedia`, `AudioWorklet`). It works on `http://localhost` but NOT over plain
`http://` from any external host — use an HTTPS tunnel.

For the full build/serve flow (dev vs. production-like single-origin via
`FE_STATIC_DIR`), HTTPS tunneling, and Windows blockers/workarounds (onecli/bun,
opencode → use CLI=claude), see [`docs/running-locally.md`](docs/running-locally.md).

## Git hooks

After clone, run `pnpm hooks:install` once. It sets `core.hooksPath=.githooks/`
so `.githooks/pre-commit` runs the i18n lint before every commit. To skip a
specific commit (rare): `git commit --no-verify`.

## Worktrees

All worktrees live under `.worktrees/<name>/`. Branch names use the `slice/` prefix;
the worktree **directory omits it** (a slash would nest a subdir). Create one with:

```bash
git worktree add .worktrees/<name> -b slice/<name> dev   # branch: slice/<name> | dir: .worktrees/<name>
```

Cleanup after merge (worktrees pile up otherwise): `git worktree remove .worktrees/<name>`,
`git branch -d slice/<name>`, `git worktree prune`.

Don't pollute the project root with worktree directories. The two long-lived
worktrees `dev/` and `main/` (at the project root) are the exception, not the rule.
Any new branch for a slice / bugfix / experiment goes under `.worktrees/`.

After `cd .worktrees/<name>`, run `pnpm install && pnpm hooks:install`.

## Ports

- **Backend**: defaults to `4000`. Override with `PORT=<n>` env var.
- **Frontend (Vite dev)**: OS-assigned (no fixed port). Vite prints the chosen
  port at startup. The proxy to `/api`, `/proxy`, `/ws` defaults to BE on 4000,
  override with `BE_PORT=<n>` env var passed to Vite.

### Running parallel worktrees

To run multiple BE+FE pairs simultaneously (e.g. two executor agents in two
worktrees), each pair gets its own port number. Convention: BE port 4000 for
the first worktree, 4001 for the second, etc.

```bash
# Worktree A — BE on 4000, FE Vite proxies → 4000 (default)
cd .worktrees/slice-X
PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts
pnpm --filter @drive-coding/frontend-v2 dev
# (no env var needed — FE defaults to BE_PORT=4000)

# Worktree B — BE on 4001, FE Vite proxies → 4001
cd .worktrees/slice-Y
PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts
BE_PORT=4001 pnpm --filter @drive-coding/frontend-v2 dev
```

Each worktree's FE will get a different OS-assigned Vite port — no conflict
on the FE side. Tunnels (if used) point at each FE's specific Vite port.

## Backend MUST run through OneCLI

The BE proxy at `/proxy/elevenlabs/*` and `/proxy/google/*` requires API
credentials injected by the OneCLI gateway. **Do NOT start the BE with a
plain `pnpm` command** — every TTS/translate call will return 401/400.

```bash
# ✅ Correct
cd packages/backend
onecli run --agent voice-acp -- bun --watch src/server.ts

# ❌ Wrong — works for boot, fails on every proxy request
pnpm --filter @drive-coding/backend dev
```

### Running BE with CORS for deployed CF Pages FE

When connecting the deployed `https://drive-coding.pages.dev` FE to a local BE,
include the Pages origin in `CORS_ORIGINS`:

```bash
# Local BE serving both local and CF Pages FE (consistent with deploy/systemd/voice-acp-be.service)
CORS_ORIGINS="https://drive-coding.pages.dev,http://localhost:4000" \
  PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts
```

See `docs/deploy-cf-pages.md` for full deploy instructions and known limitations
(mixed-content + Private Network Access).

The `voice-acp` OneCLI agent injects `xi-api-key` for `api.elevenlabs.io`
and `x-goog-api-key` for `generativelanguage.googleapis.com`. It does NOT
inject Anthropic credentials (intentional — see `~/.config/opencode/learnings.md`
2026-05-14 about Anthropic balance drain).

How to tell if the BE is missing OneCLI: the FE shows `TTS failed: 401`
and the BE log shows `proxy upstream non-2xx` warnings (since the
observability commit `a76e7c1`).

## Wire tracing & recording (debug)

Two passive taps on the ACP pipe (`packages/backend/src/acp/bridge-manager.ts`), both
**off by default**, neither alters the stream (each runs *after* the send/write).
Both live in `bridge-manager` — **always-active for the full child lifetime**, surviving
FE disconnect/reconnect cycles (unlike the previous `ws-agent` location).

- **`LOG_WIRE=acp`** — live wire summary to the BE stdout via pino (slice-wire-observability-bridge).
  Namespace: `backend.acp.wire.*` (CLI↔BE layer).
  `debug` → `{dir,type,id}`; `trace` → full decoded frame. Best for watching traffic
  inline with the rest of the BE log timeline.
- **`WIRE_RECORD=1`** — records **every raw frame** to
  `data/wire-recordings/<agentId>-<ts>.jsonl` — one `{ts,dir,raw}` line per frame,
  a clean file per child lifetime (not per WS connection — slice wire-observability-bridge).
  Best for offline analysis of anomalies (empty chunks, duplicate ids) with `jq`. Works live too:
  `tail -f data/wire-recordings/*.jsonl | jq`.

```bash
# record a session — Windows: bun direct (onecli can't spawn bun; TTS proxy unneeded here)
cd packages/backend
WIRE_RECORD=1 PORT=4000 bun src/server.ts
# ...connect an agent + prompt, then analyze. e.g. every thought-chunk text
# (we found claude sends them ALL empty — an upstream ACP-adapter issue, BE is transparent):
jq -r 'select(.raw|fromjson|.params.update.sessionUpdate=="agent_thought_chunk") | (.raw|fromjson|.params.update.content.text)' data/wire-recordings/*.jsonl
```

`data/` is gitignored — recordings never enter git.

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
| **Code design rules** — layers, what an "engine" is, when to use `$effect` vs a method, state-machine pattern, primary-vs-derived VMs | `docs/design-principles.md` §1-5 | **canonical** |
| **The 50 architectural decisions (D1-D50)** | `docs/design-principles.md` §6 | **canonical** |
| **FE five golden rules** (the short, injected version) | `packages/frontend/AGENTS.md` | canonical (design-principles expands it) |
| **UX spec** — drive-first, colors, mic states, bubbles, car mode | `docs/frontend-spec.md` | canonical |
| **FE↔BE protocol, schemas, ports** | `docs/vnext-spec.md` | canonical (§8.5 slices is OBSOLETE) |
| **The current slice roadmap** | `packages/frontend/docs/slices.md` | **source of truth** for slice order |
| **Additive design** for shared files (parallel agent work) | `docs/conventions/parallel-safe-code.md` | canonical — read BEFORE touching `context.ts`, `+layout.svelte`, `i18n/keys.ts`, `chat/+page.svelte` |
| **Per-slice rationale** (why the code looks the way it does) | `docs/decisions/voice-acp.md` | living log (written by מרדכי) |
| **How to write a slice plan** (handoff to executor) | `docs/plans/README.md` | canonical |
| **Planning history** — *how* we reached D1-D50, mental model, competitor/library research | `docs/vnext-planning.md`, `docs/vnext-research.md` | **historical** (not maintained) |

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
