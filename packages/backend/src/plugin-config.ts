import path from "node:path"
import { pathToFileURL } from "node:url"
import { AUDIO_FRIENDLY_PROMPT } from "./prompts/index.js"

/**
 * Plugin entry in opencode config — either a bare file URL (no options)
 * or a tuple `[url, options]`. Matches `@opencode-ai/plugin`'s
 * `Config.plugin` type.
 */
type PluginEntry = string | [string, Record<string, unknown>]

/**
 * Builds OPENCODE_CONFIG_CONTENT for spawning opencode with the
 * generic `prompt-injector` plugin loaded, configured with the
 * audio-friendly prompt text. Merges with the user's existing
 * OPENCODE_CONFIG_CONTENT if any.
 *
 * See `docs/audio-friendly-prompt-plan.md` §7 and the slice-14 brief
 * for the design.
 */
export function buildOpencodeConfigContent(
  existingEnv: string | undefined,
): string {
  // The plugin file lives at a fixed location relative to this source file.
  // Dev: packages/backend/plugins/prompt-injector.ts
  // import.meta.dirname = packages/backend/src → go up one level to backend root,
  // then into plugins/.
  const pluginPath = path.resolve(
    import.meta.dirname,
    "../plugins/prompt-injector.ts",
  )
  const pluginUrl = pathToFileURL(pluginPath).href

  // Merge with existing config if any (preserves user's own plugins/settings).
  const config = existingEnv?.trim()
    ? (JSON.parse(existingEnv) as Record<string, unknown>)
    : {}

  // `plugin` may be: undefined, a single string (single plugin shorthand),
  // or an array of entries (each a string OR [url, options] tuple).
  let existingPlugins: PluginEntry[] = []
  if (Array.isArray(config.plugin)) {
    existingPlugins = [...(config.plugin as PluginEntry[])]
  } else if (typeof config.plugin === "string") {
    existingPlugins = [config.plugin]
  }

  // Our entry: a tuple so we can pass the prompt text via options.
  // Optional debug: if PROMPT_INJECTOR_DEBUG_PATH env var is set, the
  // plugin will dump the final system-prompt array (JSON) to that path on
  // every chat invocation. Useful for verifying injection end-to-end.
  const debugWritePath = process.env.PROMPT_INJECTOR_DEBUG_PATH
  const ourOptions: Record<string, unknown> = { text: AUDIO_FRIENDLY_PROMPT }
  if (debugWritePath) ourOptions.debugWritePath = debugWritePath
  const ourEntry: PluginEntry = [pluginUrl, ourOptions]

  // Dedup by URL — handle both string entries and tuple entries.
  const filtered = existingPlugins.filter((p) =>
    Array.isArray(p) ? p[0] !== pluginUrl : p !== pluginUrl,
  )
  filtered.push(ourEntry)

  return JSON.stringify({
    ...config,
    $schema:
      (config.$schema as string | undefined) ??
      "https://opencode.ai/config.json",
    plugin: filtered,
  })
}
