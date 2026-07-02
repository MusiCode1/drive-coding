/**
 * pricing.ts — snapshot of TTS provider pricing for cost estimation.
 *
 * Prices are ESTIMATES. Updated: 2026-07-02. Sources noted per field.
 * Update manually when pricing changes. Mark estimates as "estimated" in output.
 */

// ─── Pricing snapshot ──────────────────────────────────────────────────────────
// Prices as of 2026-07-02. Update manually if providers change pricing.

export const TTS_PRICING = {
  elevenlabs: {
    // Creator tier ~$0.17-0.20 per 1k characters.
    // Source: https://elevenlabs.io/pricing (Creator plan, 2026-07-02)
    usdPer1kChars: 0.18,
  },
  google: {
    // gemini-3.1-flash-tts-preview, standard tier (non-cached)
    // Source: https://ai.google.dev/gemini-api/docs/pricing (2026-07-02)
    usdPer1mInputTokens: 1.0,
    usdPer1mAudioTokens: 20.0,
  },
} as const

// ─── Cost calculators ─────────────────────────────────────────────────────────

/**
 * Estimated USD cost for an ElevenLabs TTS request.
 * @param chars - number of input characters
 */
export function elevenLabsCostUsd(chars: number): number {
  return (chars / 1000) * TTS_PRICING.elevenlabs.usdPer1kChars
}

/**
 * Estimated USD cost for a Gemini TTS request.
 * @param inputTokens  - prompt token count (from usageMetadata.promptTokenCount)
 * @param audioTokens  - audio output token count (from candidatesTokensDetails[modality=AUDIO]
 *                       or fallback candidatesTokenCount for TTS-only outputs)
 */
export function geminiCostUsd(inputTokens: number, audioTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * TTS_PRICING.google.usdPer1mInputTokens
  const audioCost = (audioTokens / 1_000_000) * TTS_PRICING.google.usdPer1mAudioTokens
  return inputCost + audioCost
}
