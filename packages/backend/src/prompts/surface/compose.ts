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
  // Shared session memory (notes + agent fields). Omitted when both are empty.
  "memory",
  // Per-agent charter, last on purpose: the sections above are the environment,
  // this one is "and your job here is X". Requires opts.charter.
  "charter",
] as const

export type SurfacePromptPiece = (typeof SURFACE_PROMPT_PIECES)[number]

export type BuildSurfacePromptOptions = {
  pieces: readonly SurfacePromptPiece[]
  /** Required when \`pieces\` includes \`"runtime"\`. */
  runtime?: SurfaceRuntimeInfo
  /**
   * Per-agent charter (\`systemPrompt\` on the agent record). When the piece is
   * selected but the text is empty/absent the section is simply omitted — an
   * agent without a charter is the normal case, not an error.
   */
  charter?: string
  /** Shared session note from the agent record. */
  userNotes?: string
  /** Agent-written session fields from the agent record. */
  sessionFields?: Readonly<Record<string, string>>
}

function buildMemorySection(opts: {
  userNotes?: string
  sessionFields?: Readonly<Record<string, string>>
}): string | null {
  const noteText = opts.userNotes?.trim()
  const fieldEntries =
    opts.sessionFields !== undefined ? Object.entries(opts.sessionFields) : []
  if ((!noteText || noteText.length === 0) && fieldEntries.length === 0) {
    return null
  }
  const parts: string[] = ["# Session memory"]
  if (noteText && noteText.length > 0) {
    parts.push(`## Notes\n\n${opts.userNotes}`)
  }
  if (fieldEntries.length > 0) {
    const lines = fieldEntries.map(([key, value]) => `- **${key}**: ${value}`)
    parts.push(`## Fields\n\n${lines.join("\n")}`)
  }
  return parts.join("\n\n")
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
    if (id === "memory") {
      const memory = buildMemorySection({
        userNotes: opts.userNotes,
        sessionFields: opts.sessionFields,
      })
      if (memory !== null) {
        parts.push(memory)
      }
      continue
    }
    if (id === "charter") {
      const charter = opts.charter?.trim()
      if (charter !== undefined && charter.length > 0) {
        parts.push(`# Your assignment\n\n${charter}`)
      }
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
