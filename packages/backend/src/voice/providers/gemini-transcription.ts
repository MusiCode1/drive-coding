import type { TranscriptionModelV3 } from "@ai-sdk/provider"
import { GoogleGenAI } from "@google/genai"

/**
 * Custom Gemini transcription provider for Vercel AI SDK (D39).
 * Uses @google/genai directly since @ai-sdk/google does not expose
 * a transcription model yet.
 *
 * Supports `providerOptions.gemini.previousAssistantText` for context-aware STT.
 */
export function geminiTranscription(modelId: string): TranscriptionModelV3 {
  return {
    specificationVersion: "v3",
    provider: "gemini-transcription",
    modelId,

    async doGenerate(options) {
      // Placeholder API key — OneCLI proxy replaces the `x-goog-api-key` header
      // value at the network boundary. See providers.ts for full rationale.
      const ai = new GoogleGenAI({ apiKey: "onecli-injects-this-at-proxy" })

      const geminiOpts = options.providerOptions?.gemini as Record<string, unknown> | undefined
      const prevText = geminiOpts?.previousAssistantText as string | undefined

      const hebrewRule =
        "Output in the original script of the language spoken. If Hebrew is spoken, output Hebrew letters — do NOT transliterate to Latin characters."
      const prompt = prevText
        ? `Transcribe the user's audio. Context: the previous assistant said:\n"${prevText}"\n\nTranscribe ONLY the user's audio, in the language spoken. ${hebrewRule}`
        : `Transcribe the audio. Output ONLY the spoken words, no commentary. ${hebrewRule}`

      // Convert audio to base64 for inline data
      const audioBytes =
        options.audio instanceof Uint8Array
          ? options.audio
          : new Uint8Array(Buffer.from(options.audio, "base64"))

      const base64Audio = Buffer.from(audioBytes).toString("base64")

      const response = await ai.models.generateContent({
        model: modelId,
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: options.mediaType,
                  data: base64Audio,
                },
              },
            ],
          },
        ],
      })

      const text = response.text ?? ""

      return {
        text,
        segments: [],
        language: undefined,
        durationInSeconds: undefined,
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId,
          headers: undefined,
        },
      }
    },
  }
}
