/**
 * gemini-usage-accumulator.ts — incremental Gemini SSE usage extractor.
 *
 * Slice: proxy-tap-memory (Commit 0)
 *
 * Accepts raw Uint8Array chunks from a Gemini streamGenerateContent SSE stream
 * and extracts usageMetadata incrementally — without retaining audio inlineData.
 *
 * Handles two boundary traps:
 *   1. Line boundary — SSE data: line split across chunk boundaries → leftover buffer.
 *   2. UTF-8 boundary — multi-byte character split across chunk boundaries → streaming TextDecoder.
 *
 * Zero-retain guarantee: only the numeric usage fields (inputTokens, audioTokens) are
 * stored; inlineData/audio bytes are never accumulated.
 */

import type { GeminiUsage } from "./extract.js"
import { parseGeminiChunkUsage } from "./extract.js"

export interface GeminiUsageAccumulator {
  /** Feeds a raw chunk from the SSE stream. Bounded: processes complete lines, does not buffer audio. */
  push(chunk: Uint8Array): void
  /** The last usageMetadata seen so far, normalized to GeminiUsage. */
  result(): GeminiUsage
}

export function createGeminiUsageAccumulator(): GeminiUsageAccumulator {
  // stream:true handles utf8 boundaries between chunks
  const decoder = new TextDecoder("utf-8")

  // Partial tail of the last incomplete line, carried across chunks
  let leftover = ""

  // Last seen GeminiUsage (last-wins)
  let last: GeminiUsage = { inputTokens: 0, audioTokens: 0 }

  return {
    push(chunk: Uint8Array): void {
      // decode with stream:true — handles utf8 multibyte boundaries
      const text = decoder.decode(chunk, { stream: true })
      leftover += text

      // Split on newlines; the last (possibly partial) line stays in leftover
      const lines = leftover.split("\n")
      leftover = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("data:")) continue
        const jsonPart = trimmed.slice("data:".length).trim()
        if (!jsonPart || jsonPart === "[DONE]") continue

        try {
          const parsed: unknown = JSON.parse(jsonPart)
          const usage = parseGeminiChunkUsage(parsed)
          if (usage !== undefined) {
            // last-wins: store only numbers, never audio bytes
            last = usage
          }
        } catch {
          // JSON parse failure → skip line (stream continues)
        }
      }
    },

    result(): GeminiUsage {
      return { ...last }
    },
  }
}
