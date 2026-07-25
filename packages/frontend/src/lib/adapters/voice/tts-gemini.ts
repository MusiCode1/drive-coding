/**
 * tts-gemini.ts — Gemini TTS provider.
 *
 * משתמש ב-googleGenAi().models.generateContentStream (SDK @google/genai)
 * דרך הפרוקסי ב-BE (/proxy/google/). OneCLI voice-acp מזריק x-goog-api-key.
 *
 * פלט: PCM l16, 24kHz, mono — mimeType "audio/l16; rate=24000; channels=1".
 * כל SSE event: candidates[0].content.parts[0].inlineData.data = base64(PCM-chunk).
 *
 * noUncheckedIndexedAccess: optional-chain מלא בכל גישה ל-candidates/parts.
 *
 * abort: config.abortSignal מועבר ל-SDK (תמיכה מאומתת מ-genai.d.ts:4207).
 */

import type { TtsProvider, TtsRequest } from "@drive-coding/core/voice/tts-types"
import { base64ToBytes } from "./base64"
import { buildGeminiDirecting } from "./gemini-directing"
import { googleGenAi } from "./sdks"

export const geminiTts: TtsProvider = {
  format: "pcm",
  async synthesize(req: TtsRequest): Promise<ReadableStream<Uint8Array>> {
    const voiceName = req.voiceId || "Kore"
    const text = buildGeminiDirecting(req) // req נושא { text, directing }

    const iter = await googleGenAi().models.generateContentStream({
      model: req.modelId ?? "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
        // העברת abort signal ל-SDK (ביטול מהיר)
        abortSignal: req.signal,
      },
    })

    // generateContentStream → Promise<AsyncGenerator<GenerateContentResponse>>.
    // ה-for-await שייך ל-start (חד-פעמי, צורך עד done), לא ל-pull.
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of iter) {
            // noUncheckedIndexedAccess → optional-chain מלא בכל index:
            const b64 = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
            if (b64) controller.enqueue(base64ToBytes(b64))
          }
          controller.close()
        } catch (e) {
          controller.error(e)
        }
      },
      cancel() {
        // ביטול ה-stream → SDKיסיים את ה-for-await דרך abortSignal
      },
    })
  },
}
