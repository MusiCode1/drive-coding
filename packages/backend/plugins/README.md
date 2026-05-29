# Backend Plugins

Plugins injected into CLI sub-processes via `OPENCODE_CONFIG_CONTENT`.

These files **must stay accessible as separate TS files at runtime** — OpenCode loads
them directly via `file://` URL using Bun. They are NOT bundled with the backend code.

## How it works

When spawning an `opencode` sub-process, `packages/backend/src/plugin-config.ts`
builds a JSON config containing a `file://` URL pointing to the plugin file here
(plus per-plugin options as a tuple `[url, options]`). That config is passed via
the `OPENCODE_CONFIG_CONTENT` environment variable.

OpenCode merges this config with any existing user config, loads the plugin,
and fires the `experimental.chat.system.transform` hook before every LLM call.

## The `prompt-injector` plugin

Generic plugin that appends a system-prompt string (passed via `options.text`)
to every chat's system prompts. The actual prompt content lives in the backend
under `src/prompts/` — the plugin is purely the mechanism.

This indirection lets us:
- Update prompt text without restarting the spawned `opencode` process pool
  (it's read at spawn time, but no plugin rebuild needed).
- Use the same plugin with different prompt profiles in the future (e.g.
  audio-friendly, coding-focused, tutoring) — just pass different `options.text`.
- Keep the plugin tiny + reusable, separate from the BE's prompt catalog.

See slice 11 for the original audio-friendly behavior and slice 14 for the
generic refactor.

## Adding a new plugin

1. Create `<name>.ts` in this directory.
2. Export a `PluginModule` (with `id` + `server`) or a bare `Plugin` function
   (see `@opencode-ai/plugin` types).
3. Register the file URL in `plugin-config.ts` (as a string for option-less
   plugins, or a `[url, options]` tuple for parameterized ones).

## Production notes

If voice-acp is ever packaged as a binary, the `plugins/` directory must be
copied to the output alongside the binary so the `file://` URLs remain valid.

See `docs/audio-friendly-prompt-plan.md` §5 for full rationale.
