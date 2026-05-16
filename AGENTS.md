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
- `packages/frontend/` — SvelteKit drive-first PWA.

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
pnpm lint
pnpm format
```

## What NOT to do

- No secrets in code (`.env` is gitignored)
- No CommonJS (`require`, `module.exports`)
- No adapters in `core/` — they live in `backend/adapters/`
- No browser globals in `core/`

## Reference

- `docs/vnext-architecture.md` — 50 decisions (D1-D50)
- `docs/vnext-spec.md` — protocol, schemas, ports, roadmap
- `docs/vnext-research.md` — competitor analysis, library research
- `docs/slice-X-brief.md` — current slice's implementation brief

## Working with Tama (planner)

If you hit any of these — **stop and ask Tama via the parent task**:
- Architectural decision not covered by D1-D50
- Spec ambiguity that affects > 50 lines of code
- A library/tool failing in a way that suggests our stack choice was wrong
- A test infrastructure gap

Otherwise: decide reasonably, document in commit message, continue.
