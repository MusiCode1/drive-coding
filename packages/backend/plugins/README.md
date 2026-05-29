# Backend Plugins

Plugins injected into CLI sub-processes via `OPENCODE_CONFIG_CONTENT`.

These files **must stay accessible as separate TS files at runtime** — OpenCode loads
them directly via `file://` URL using Bun. They are NOT bundled with the backend code.

## How it works

When spawning an `opencode` sub-process, `packages/backend/src/plugin-config.ts`
builds a JSON config containing a `file://` URL pointing to the plugin file here.
That config is passed via the `OPENCODE_CONFIG_CONTENT` environment variable.

OpenCode merges this config with any existing user config, loads the plugin,
and fires the `experimental.chat.system.transform` hook before every LLM call.

## Adding a new plugin

1. Create `<name>.ts` in this directory.
2. Export a `Plugin` function (see `@opencode-ai/plugin` types).
3. Register the file URL in `plugin-config.ts`.

## Production notes

If voice-acp is ever packaged as a binary, the `plugins/` directory must be
copied to the output alongside the binary so the `file://` URLs remain valid.

See `docs/audio-friendly-prompt-plan.md` §5 for full rationale.
