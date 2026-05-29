/**
 * transcribe.ts — Speech-to-Text via Gemini multimodal (audio inline).
 *
 * Uses @google/genai (NOT @ai-sdk/google) because it needs generateContent
 * with inlineData audio parts — @ai-sdk/google doesn't support multimodal audio.
 *
 * CRIT-1: googleGenAi uses httpOptions.baseUrl (lowercase u) — see sdks.ts.
 * Hebrew transliteration gotcha (learnings 2026-05-16): Gemini returns Latin
 * by default. Must explicitly request Hebrew script in prompt.
 *
 * saveRecording removed (slice 10 will add the BE endpoint). Returns
 * recordingId: "" as a stub — slice 10 will replace with the real call.
 *
 * Copied from main/packages/frontend/src/lib/voice/stt-client.ts (slice 3).
 * Changes:
 *   (a) removed `import { saveRecording } from "./recordings-client"`
 *   (b) replaced saveRecording call with Promise.resolve({ id: "" })
 *   (c) import of googleGenAi from "./sdks" unchanged (sdks.ts exists from slice 2)
 */

import { bytesToBase64 } from "./base64"
import { googleGenAi } from "./sdks"

export async function transcribe(
  blob: Blob,
  opts: {
    previousAssistantText?: string
    signal?: AbortSignal
  } = {},
): Promise<{ text: string; recordingId: string }> {
  const audioBytes = new Uint8Array(await blob.arrayBuffer())
  const mimeType = blob.type || "audio/webm"

  // Stub: slice 10 will replace with real saveRecording call
  const recordingPromise = Promise.resolve({ id: "" })

  // Hebrew transliteration fix: explicit instruction to output Hebrew script
  const hebrewRule =
    "Output in the original script of the language spoken. If Hebrew, output Hebrew letters."
  const prompt = opts.previousAssistantText
    ? `Transcribe the user's audio. Context: previous assistant said: "${opts.previousAssistantText}". Transcribe ONLY user's audio. ${hebrewRule}`
    : `Transcribe the audio. ${hebrewRule}`

  // MED-5: chunked base64 conversion
  const base64 = bytesToBase64(audioBytes)

  const response = await googleGenAi.models.generateContent({
    model: "gemini-flash-latest",
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
      },
    ],
    // abortSignal via config if supported by this SDK version
    config: opts.signal ? ({ abortSignal: opts.signal } as Record<string, unknown>) : undefined,
  })

  const { id: recordingId } = await recordingPromise
  const text = response.text ?? ""
  return { text, recordingId }
}
