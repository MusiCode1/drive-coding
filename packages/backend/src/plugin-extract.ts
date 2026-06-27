import { createHash } from "node:crypto"
import { copyFileSync, existsSync, readFileSync } from "node:fs"
import path from "node:path"

// .ts plugin embedded as asset — verified in spikes 27/06:
// `import ... with { type: "file" }` embeds the raw .ts source in the binary as a $bunfs path.
// TypeScript does not understand this Bun-specific import attribute and infers the wrong type,
// so we suppress the error and cast to string (the actual runtime value).
// @ts-expect-error — Bun asset import; TS infers wrong type (PluginModule instead of string)
import _pluginSrcRaw from "../plugins/prompt-injector.ts" with { type: "file" }
import { isBinary } from "./binary.js"
import { ensureStateSubdir } from "./paths.js"

const pluginSrc = _pluginSrcRaw as unknown as string

/**
 * Ensures the prompt-injector plugin is available at a stable filesystem path.
 *
 * Binary mode: extracts from embedded $bunfs asset to getStateDir()/plugins/
 *   (copies only when missing or content differs — idempotent).
 * Dev mode: returns the local plugins/ path directly (no copy needed).
 *
 * Returns an absolute path suitable for pathToFileURL() in plugin-config.ts.
 */
export function ensurePluginExtracted(): string {
  if (!isBinary()) {
    // Dev path — plugin lives next to backend/plugins/
    return path.resolve(import.meta.dirname, "../plugins/prompt-injector.ts")
  }

  // Binary mode: extract embedded asset to state dir.
  const pluginsDir = ensureStateSubdir("plugins")
  const destPath = path.join(pluginsDir, "prompt-injector.ts")

  // Read embedded source from $bunfs path.
  const srcContent = readFileSync(pluginSrc, "utf8")

  // Only write if file is missing or content differs (hash check — avoids unnecessary IO).
  let needsCopy = !existsSync(destPath)
  if (!needsCopy) {
    const existingHash = createHash("sha256").update(readFileSync(destPath, "utf8")).digest("hex")
    const srcHash = createHash("sha256").update(srcContent).digest("hex")
    needsCopy = existingHash !== srcHash
  }

  if (needsCopy) {
    copyFileSync(pluginSrc, destPath)
  }

  return destPath
}
