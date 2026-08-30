/**
 * Compose selected surface-prompt pieces for later injection.
 * No wiring yet — callers pick pieces per context (screen vs Live, first turn, …).
 */

import { SURFACE_ABOUT } from "./about.js"
import { SURFACE_CAPABILITIES } from "./capabilities.js"
import { SURFACE_DISPLAY } from "./display.js"
import { buildSurfaceRuntime, type SurfaceRuntimeInfo } from "./runtime.js"

export const SURFACE_PROMPT_PIECES = [
  "about",
  "runtime",
  "capabilities",
  "display",
] as const

export type SurfacePromptPiece = (typeof SURFACE_PROMPT_PIECES)[number]

export type BuildSurfacePromptOptions = {
  pieces: readonly SurfacePromptPiece[]
  /** Required when \`pieces\` includes \`"runtime"\`. */
  runtime?: SurfaceRuntimeInfo
}

/**
 * Join selected sections with blank lines, in catalog order (not caller order),
 * so partial injections stay stable and dedupe cleanly.
 */
export function buildSurfacePrompt(opts: BuildSurfacePromptOptions): string {
  const wanted = new Set(opts.pieces)
  const parts: string[] = []

  for (const id of SURFACE_PROMPT_PIECES) {
    if (!wanted.has(id)) continue
    if (id === "about") {
      parts.push(SURFACE_ABOUT)
      continue
    }
    if (id === "capabilities") {
      parts.push(SURFACE_CAPABILITIES)
      continue
    }
    if (id === "display") {
      parts.push(SURFACE_DISPLAY)
      continue
    }
    // runtime
    if (opts.runtime === undefined) {
      throw new Error('buildSurfacePrompt: piece "runtime" requires opts.runtime')
    }
    parts.push(buildSurfaceRuntime(opts.runtime))
  }

  return parts.join("\n\n")
}
