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
 *
 * Debug option — `options.debugWritePath` (string):
 *   If set, the plugin atomically writes the final `output.system` array
 *   (as JSON) to this path on every invocation. Useful for verifying that
 *   the prompt actually reaches the LLM and seeing what other system
 *   prompts opencode is layering on. No-op if unset.
 */
const plugin: PluginModule = {
  id: "prompt-injector",
  async server(
    _input: PluginInput,
    options?: Record<string, unknown>,
  ): Promise<Hooks> {
    // Commit 3 (windows-adaptation): fallback לenv כשopencode טוען את הפלאגין כ-string-URL
    // ללא options (opencode 1.2.27 — plugin: string[], לא tuple).
    // options.text גובר על env (backwards compat למי שעדיין משתמש ב-tuple בקונפיג ישן).
    const text =
      typeof options?.text === "string"
        ? options.text
        : (process.env.PROMPT_INJECTOR_TEXT ?? "")
    const debugWritePath =
      typeof options?.debugWritePath === "string"
        ? options.debugWritePath
        : (process.env.PROMPT_INJECTOR_DEBUG_PATH ?? null)

    return {
      "experimental.chat.system.transform": async (_hookInput, output) => {
        if (text.length > 0) {
          output.system.push(text)
        }
        if (debugWritePath) {
          // Dynamic import — keeps node:fs out of the module-load path for
          // environments that don't need debug (smaller blast radius if the
          // plugin ever runs in a context without fs).
          try {
            const { writeFile, rename } = await import("node:fs/promises")
            const payload = JSON.stringify(
              {
                timestamp: new Date().toISOString(),
                systemPromptCount: output.system.length,
                systemPrompts: output.system,
              },
              null,
              2,
            )
            // Atomic: write to .tmp, then rename. Avoids partial reads.
            const tmpPath = `${debugWritePath}.tmp`
            await writeFile(tmpPath, payload, "utf8")
            await rename(tmpPath, debugWritePath)
          } catch (err) {
            // Defensive — debug write failures must not break the chat.
            // eslint-disable-next-line no-console
            console.warn(
              "[prompt-injector] debug write failed:",
              (err as Error).message,
            )
          }
        }
      },
    }
  },
}

export default plugin
