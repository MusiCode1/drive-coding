# drive-coding

**English** · [עברית](./README.he.md)

A voice-first, hands-free interface for ACP-compatible CLI coding agents
(currently [opencode](https://opencode.ai) and Claude Code). One command
launches a backend server and serves the web UI from the same origin — talk
to your coding agent from the browser, on desktop or phone, with streaming
text-to-speech and push-to-talk.

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

Start with [`AGENTS.md`](AGENTS.md) — it's the map to the rest of the docs
(architecture, conventions, running locally, git worktree workflow). Longer
technical background lives in [`docs/design-principles.md`](docs/design-principles.md)
and [`docs/roadmap.md`](docs/roadmap.md).

## License

MIT — see [`LICENSE`](LICENSE).
