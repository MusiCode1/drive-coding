/**
 * extract.ts — pure extractors for TTS usage metadata from provider responses.
 *
 * Both functions are pure (no IO) and return safe defaults (zeros) on parse failure.
 * Suitable for use in a background tap without risk of crashing the proxy.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type GeminiUsage = { inputTokens: number; audioTokens: number }

// Internal: Gemini usageMetadata shape (subset we care about)
type UsageMetadata = {
  promptTokenCount?: number
  candidatesTokenCount?: number
  candidatesTokensDetails?: Array<{ modality: string; tokenCount: number }>
}

type GeminiResponseChunk = {
  usageMetadata?: UsageMetadata
}

// ─── ElevenLabs extractor ─────────────────────────────────────────────────────

/**
 * Extracts the char count of the `text` field from an ElevenLabs TTS request body.
 * ElevenLabs charges per character of input text.
 * Returns 0 on any parse failure (safe default).
 *
 * @param body - raw request body as Uint8Array or string
 */
export function extractElevenLabsChars(body: Uint8Array | string): number {
  try {
    const text = typeof body === "string" ? body : new TextDecoder().decode(body)
    if (!text) return 0
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== "object" || parsed === null) return 0
    const { text: inputText } = parsed as Record<string, unknown>
    if (typeof inputText !== "string") return 0
    return inputText.length
  } catch {
    return 0
  }
}

// ─── Gemini SSE extractor ─────────────────────────────────────────────────────

/**
 * Extracts token usage from Gemini streamGenerateContent SSE or JSON-array response.
 *
 * The usageMetadata appears in the last chunk (or accumulates); we take the LAST
 * one seen in the stream.
 *
 * audioTokens priority:
 * 1. candidatesTokensDetails[].modality === "AUDIO" → exact audio token count
 * 2. Fallback: candidatesTokenCount (for TTS, the output is audio-only, good estimate)
 *    Note: This fallback is an estimate; use candidatesTokensDetails when available.
 *
 * Returns { inputTokens: 0, audioTokens: 0 } on any parse failure.
 *
 * @param responseBytes - raw response bytes (SSE format or JSON array) as Uint8Array or string
 */
export function extractGeminiUsage(responseBytes: Uint8Array | string): GeminiUsage {
  try {
    const text =
      typeof responseBytes === "string" ? responseBytes : new TextDecoder().decode(responseBytes)

    if (!text) return { inputTokens: 0, audioTokens: 0 }

    // Collect all parsed response chunks
    const chunks: GeminiResponseChunk[] = []

    // Try SSE format: lines starting with "data: "
    const sseLines = text.split("\n")
    let parsedSse = false
    for (const line of sseLines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const jsonPart = trimmed.slice("data:".length).trim()
      if (!jsonPart || jsonPart === "[DONE]") continue
      try {
        const chunk = JSON.parse(jsonPart) as GeminiResponseChunk
        chunks.push(chunk)
        parsedSse = true
      } catch {
        // Skip malformed SSE lines
      }
    }

    // If no SSE data found, try JSON array format
    if (!parsedSse) {
      try {
        const parsed = JSON.parse(text) as unknown
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            chunks.push(item as GeminiResponseChunk)
          }
        }
      } catch {
        // Not JSON array either — return zeros
      }
    }

    if (chunks.length === 0) return { inputTokens: 0, audioTokens: 0 }

    // Take the LAST usageMetadata seen (most complete/accurate)
    let lastMeta: UsageMetadata | undefined
    for (const chunk of chunks) {
      if (chunk.usageMetadata) {
        lastMeta = chunk.usageMetadata
      }
    }

    if (!lastMeta) return { inputTokens: 0, audioTokens: 0 }

    const inputTokens = lastMeta.promptTokenCount ?? 0

    // audioTokens: prefer exact AUDIO modality from candidatesTokensDetails
    let audioTokens = 0
    if (lastMeta.candidatesTokensDetails && lastMeta.candidatesTokensDetails.length > 0) {
      const audioEntry = lastMeta.candidatesTokensDetails.find((d) => d.modality === "AUDIO")
      if (audioEntry) {
        audioTokens = audioEntry.tokenCount
      } else {
        // candidatesTokensDetails present but no AUDIO entry found →
        // fallback to candidatesTokenCount (TTS output is audio-only)
        audioTokens = lastMeta.candidatesTokenCount ?? 0
      }
    } else {
      // No candidatesTokensDetails at all → fallback to candidatesTokenCount
      // For TTS, the entire output is audio, so candidatesTokenCount ≈ audioTokenCount
      audioTokens = lastMeta.candidatesTokenCount ?? 0
    }

    return { inputTokens, audioTokens }
  } catch {
    return { inputTokens: 0, audioTokens: 0 }
  }
}
