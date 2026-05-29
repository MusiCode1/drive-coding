import type { Hooks, PluginInput, PluginModule } from "@opencode-ai/plugin"

/**
 * Generic prompt-injector plugin.
 *
 * Receives the system-prompt text via plugin options (`options.text`) and
 * appends it to every chat's system prompts (via the
 * `experimental.chat.system.transform` hook).
 *
 * The actual prompt text lives in the backend (`src/prompts/`) and is
 * passed in by `plugin-config.ts` at spawn time. This file is purely the
 * "mechanism" — no hardcoded prompt content.
 *
 * Usage in opencode config:
 *   plugin: [["file:///abs/path/prompt-injector.ts", { text: "..." }]]
 *
 * If `options.text` is missing/empty/non-string, the hook is a no-op
 * (defensive — the BE always passes a non-empty string today, but a
 * future caller that forgets the options shouldn't break the agent).
 */
const plugin: PluginModule = {
  id: "prompt-injector",
  async server(
    _input: PluginInput,
    options?: Record<string, unknown>,
  ): Promise<Hooks> {
    const text = typeof options?.text === "string" ? options.text : ""
    return {
      "experimental.chat.system.transform": async (_hookInput, output) => {
        if (text.length > 0) {
          output.system.push(text)
        }
      },
    }
  },
}

export default plugin
