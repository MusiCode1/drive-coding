# AGENTS.md — drive-coding

## Project

Voice-first hands-free interface for ACP-compatible CLI agents.
See `docs/vnext-architecture.md` for full spec.

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

## Git hooks

After clone, run `pnpm hooks:install` once. It sets `core.hooksPath=.githooks/`
so `.githooks/pre-commit` runs the i18n lint before every commit. To skip a
specific commit (rare): `git commit --no-verify`.

## Worktrees

All worktrees live under `.worktrees/<branch-name>/`. Create a new one with:

```bash
git worktree add .worktrees/<name> -b <name> dev
```

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

## What NOT to do

- No secrets in code (`.env` is gitignored)
- No CommonJS (`require`, `module.exports`)
- No adapters in `core/` — they live in `backend/adapters/`
- No browser globals in `core/`

## Reference

- `docs/vnext-architecture.md` — 50 decisions (D1-D50)
- `docs/vnext-spec.md` — protocol, schemas, ports. §8.5 (slices) is OBSOLETE — see below.
- `docs/vnext-research.md` — competitor analysis, library research
- `docs/frontend-spec.md` — drive-first UX spec (still authoritative)
- `packages/frontend/docs/slices.md` — **current slice roadmap** (source of truth)
- `packages/frontend/AGENTS.md` — five golden rules for FE code
- `docs/conventions/parallel-safe-code.md` — **additive design** for shared files.
  Read BEFORE touching `context.ts`, `+layout.svelte`, `i18n/keys.ts`, `chat/+page.svelte`,
  or any other file that 2+ future slices will modify. Required for parallel agent work.
- `docs/plans/README.md` — how to write a slice plan (for handoff to executor agents).

## עבודה עם מרדכי (planner)

If you hit any of these — **stop and ask מרדכי via the parent task**:
- Architectural decision not covered by D1-D50
- Spec ambiguity that affects > 50 lines of code
- A library/tool failing in a way that suggests our stack choice was wrong
- A test infrastructure gap

Otherwise: decide reasonably, document in commit message, continue.
