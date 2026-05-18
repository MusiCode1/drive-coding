/**
 * stt-client.ts — Speech-to-Text via Gemini multimodal (audio inline).
 *
 * Uses @google/genai (NOT @ai-sdk/google) because it needs generateContent
 * with inlineData audio parts — @ai-sdk/google doesn't support multimodal audio.
 *
 * CRIT-1: googleGenAi uses httpOptions.baseUrl (lowercase u) — see sdks.ts.
 * Hebrew transliteration gotcha (learnings 2026-05-16): Gemini returns Latin
 * by default. Must explicitly request Hebrew script in prompt.
 *
 * Recording is saved in background, parallel to STT.
 */

import { bytesToBase64 } from "./base64"
import { saveRecording } from "./recordings-client"
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

  // Save recording in background, parallel to STT (don't await yet)
  const recordingPromise = saveRecording(audioBytes, mimeType).catch(() => ({ id: "" }))

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
