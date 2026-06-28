import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

// Inline source string — generated at build time by build-binary.mjs (same pattern as fe-manifest.gen.ts).
// Dev: PROMPT_INJECTOR_SRC = "" (stub); the dev path below is used instead.
// Binary: PROMPT_INJECTOR_SRC holds the full plugin source embedded at compile time.
// NOTE: asset import with { type:"file" } was removed — a .ts file above the entry dir (../)
//   gets a $bunfs name containing "../" that escapes the bundle root → readFileSync throws ENOENT
//   in the binary. Inline string avoids the path issue entirely. (See §0 spike 5 in brief.)
import { PROMPT_INJECTOR_SRC } from "./plugin-src.gen.js"
import { isBinary } from "./binary.js"
import { ensureStateSubdir } from "./paths.js"

/**
 * Ensures the prompt-injector plugin is available at a stable filesystem path.
 *
 * Binary mode: extracts from inline source string (embedded at build time) to
 *   getStateDir()/plugins/ (copies only when missing or content differs — idempotent).
 * Dev mode: returns the local plugins/ path directly (no copy needed).
 *
 * Returns an absolute path suitable for pathToFileURL() in plugin-config.ts.
 */
export function ensurePluginExtracted(): string {
  if (!isBinary()) {
    // Dev path — plugin lives next to backend/plugins/
    return path.resolve(import.meta.dirname, "../plugins/prompt-injector.ts")
  }

  // Binary mode: extract embedded source to state dir.
  const pluginsDir = ensureStateSubdir("plugins")
  const destPath = path.join(pluginsDir, "prompt-injector.ts")

  // Only write if file is missing or content differs (hash check — avoids unnecessary IO).
  let needsWrite = !existsSync(destPath)
  if (!needsWrite) {
    const existingHash = createHash("sha256").update(readFileSync(destPath, "utf8")).digest("hex")
    const srcHash = createHash("sha256").update(PROMPT_INJECTOR_SRC).digest("hex")
    needsWrite = existingHash !== srcHash
  }

  if (needsWrite) {
    writeFileSync(destPath, PROMPT_INJECTOR_SRC, "utf8")
  }

  return destPath
}
