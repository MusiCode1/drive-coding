/**
 * append-dictation.ts — pure separator rules for appending transcribed text to a draft.
 * (slice dictate-to-input, C0)
 */

/** Append transcribed chunk to a draft. Trim chunk. Empty chunk → existing unchanged. */
export function appendDictation(existing: string, chunk: string): string {
  const trimmed = chunk.trim()
  if (trimmed === "") return existing
  if (existing === "") return trimmed

  const last = existing.at(-1)
  if (last === "\n" || last === " " || last === "\t") {
    return existing + trimmed
  }
  return `${existing} ${trimmed}`
}
