# drive-coding

**English** · [עברית](./README.he.md)

A voice-first, hands-free interface for ACP-compatible CLI coding agents.
One command launches a backend server and serves the web UI from the same
origin — talk to your coding agent from the browser, on desktop or phone,
with streaming text-to-speech and push-to-talk.

Seven agents ship built in — [opencode](https://opencode.ai), Claude Code,
Gemini CLI, Codex, Qoder, Cursor and Grok — and the registry is open: any
other ACP-speaking CLI can be added from a config file, without a code
change. See [`deploy/cli-specs.jsonc`](deploy/cli-specs.jsonc) and its
[JSON Schema](deploy/cli-specs.schema.json).

## Use it (no repo clone needed)

```bash
bunx drive-coding
```

Requires [Bun](https://bun.sh) ≥ 1.3. See
[`packages/release/README.md`](packages/release/README.md) for the full
end-user guide (CLI flags, environment variables, troubleshooting).

## Develop / contribute

This is a Bun-workspaces monorepo.

```bash
bun install
bun run dev           # runs backend + frontend in parallel
```

- Backend: http://localhost:4000
- Frontend (Vite dev): OS-assigned port, printed on start

```bash
bun run test          # all tests
bun run typecheck
bun run lint          # Biome
bun run hooks:install # one-time: enables the i18n pre-commit hook
```

### Structure

- `packages/core/` — pure logic, no IO.
- `packages/backend/` — Hono server (REST + WebSocket) + ACP process bridge.
- `packages/frontend/` — SvelteKit voice-first PWA.
- `packages/provider/` — provider-agnostic ACP/CLI connection layer.
- `packages/release/` — the published `drive-coding` npm package (bundles the above).

Start with [`AGENTS.md`](AGENTS.md) — conventions, running locally, and the
git worktree workflow.

> **On the deeper design docs:** the architecture notes, the roadmap and the
> per-slice decision log live in a separate private repository, so paths of the
> form `docs-for-llm/…` referenced from `AGENTS.md` are **not** part of this
> clone. They are working notes for the agents that build this project, not
> user documentation — nothing you need in order to run or use drive-coding is
> hidden there.

## License

MIT — see [`LICENSE`](LICENSE).
