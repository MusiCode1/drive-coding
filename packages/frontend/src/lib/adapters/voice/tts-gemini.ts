/**
 * tts-gemini.ts — Gemini TTS provider.
 *
 * משתמש ב-googleGenAi().models.generateContentStream (SDK @google/genai)
 * דרך הפרוקסי ב-BE (/proxy/google/). OneCLI voice-acp מזריק x-goog-api-key.
 *
 * פלט: PCM l16, 24kHz, mono — mimeType "audio/l16; rate=24000; channels=1".
 * כל SSE event: candidates[0].content.parts[0].inlineData.data = base64(PCM-chunk).
 *
 * Gemini 3.8: directing ב-Part.speechMetadata.style; transcript verbatim ב-Part.text.
 * Gemini 3.1 ומודלים אחרים: buildGeminiDirecting בגוף Part.text (ללא speechMetadata).
 *
 * noUncheckedIndexedAccess: optional-chain מלא בכל גישה ל-candidates/parts.
 *
 * abort: config.abortSignal מועבר ל-SDK (תמיכה מאומתת מ-genai.d.ts:4207).
 */

import type { TtsProvider, TtsRequest } from "@drive-coding/core/voice/tts-types"
import { base64ToBytes } from "./base64"
import { buildGeminiDirecting, buildGeminiStyle } from "./gemini-directing"
import { googleGenAi } from "./sdks"
import { isGemini38TtsModel } from "./tts-resolve"

export const geminiTts: TtsProvider = {
  format: "pcm",
  async synthesize(req: TtsRequest): Promise<ReadableStream<Uint8Array>> {
    const voiceName = req.voiceId || "Kore"
    const model = req.modelId ?? "gemini-3.1-flash-tts-preview"

    const useSpeechMetadata = isGemini38TtsModel(model)
    const style = useSpeechMetadata ? buildGeminiStyle(req.directing) : undefined
    const contents = useSpeechMetadata
      ? [
          {
            parts: [
              {
                text: req.text,
                ...(style !== undefined ? { speechMetadata: { style } } : {}),
              },
            ],
          },
        ]
      : [{ parts: [{ text: buildGeminiDirecting(req) }] }]

    const iter = await googleGenAi().models.generateContentStream({
      model,
      contents,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
        abortSignal: req.signal,
      },
    })

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of iter) {
            const b64 = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
            if (b64) controller.enqueue(base64ToBytes(b64))
          }
          controller.close()
        } catch (e) {
          controller.error(e)
        }
      },
      cancel() {
        // ביטול ה-stream → SDK יסיים את ה-for-await דרך abortSignal
      },
    })
  },
}
