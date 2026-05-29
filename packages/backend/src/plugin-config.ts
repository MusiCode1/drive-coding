import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Builds OPENCODE_CONFIG_CONTENT for spawning opencode with the
 * audio-friendly plugin injected. Merges with user's existing
 * OPENCODE_CONFIG_CONTENT if any (see docs/audio-friendly-prompt-plan.md §7).
 */
export function buildOpencodeConfigContent(
  existingEnv: string | undefined,
): string {
  // The plugin file lives at a fixed location relative to this source file.
  // Dev: packages/backend/plugins/audio-friendly.ts
  // import.meta.dirname = packages/backend/src → go up one level to backend root,
  // then into plugins/.
  const pluginPath = path.resolve(
    import.meta.dirname,
    "../plugins/audio-friendly.ts",
  )
  const pluginUrl = pathToFileURL(pluginPath).href

  // Merge with existing config if any (preserves user's own plugins/settings).
  const config = existingEnv?.trim()
    ? (JSON.parse(existingEnv) as Record<string, unknown>)
    : {}
  const existingPlugins = Array.isArray(config.plugin)
    ? [...(config.plugin as unknown[])]
    : typeof config.plugin === "string"
      ? [config.plugin]
      : []
  if (!existingPlugins.includes(pluginUrl)) {
    existingPlugins.push(pluginUrl)
  }

  return JSON.stringify({
    ...config,
    $schema: (config.$schema as string) ?? "https://opencode.ai/config.json",
    plugin: existingPlugins,
  })
}
