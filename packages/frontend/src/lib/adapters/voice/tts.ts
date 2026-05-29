/**
 * tts.ts — המרת טקסט לדיבור (TTS) בהזרמה דרך ElevenLabs (קריאת fetch ישירה דרך הפרוקסי ב-BE).
 *
 * החבילה @ai-sdk/elevenlabs לא תומכת בהזרמה — לכן משתמשים ב-fetch ישיר.
 * כותרות (Headers): ה-xi-api-key הוא פלייסיהולדר — OneCLI מזריק את המפתח האמיתי בפרוקסי.
 *
 * מודל v3 של ElevenLabs הכרחי עבור עברית (learnings 2026-05-13).
 * מחזיר ReadableStream<Uint8Array> עבור שימוש ב-MediaSource.
 */

import { beUrl } from "$lib/util/be-url"

export interface TtsOptions {
  text: string
  voiceId: string
  modelId?: string
  signal?: AbortSignal
}

export async function synthesizeStreaming(opts: TtsOptions): Promise<ReadableStream<Uint8Array>> {
  // eleven_v3 הוא מודל ה-ElevenLabs היחיד שתומך בעברית (learnings 2026-05-13)
  const modelId = opts.modelId ?? "eleven_v3"

  const response = await fetch(
    beUrl(`/proxy/elevenlabs/v1/text-to-speech/${opts.voiceId}/stream`),
    {
      method: "POST",
      headers: {
        "xi-api-key": "browser-placeholder", // הפרוקסי של OneCLI מחליף במפתח האמיתי
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: opts.text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: opts.signal,
    },
  )

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`TTS failed: ${response.status} ${body}`)
  }
  if (!response.body) {
    throw new Error("TTS: no body in response")
  }

  return response.body
}
