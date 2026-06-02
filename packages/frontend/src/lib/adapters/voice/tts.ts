/**
 * tts.ts — המרת טקסט לדיבור (TTS) בהזרמה דרך ElevenLabs (קריאת fetch ישירה דרך הפרוקסי ב-BE).
 *
 * החבילה @ai-sdk/elevenlabs לא תומכת בהזרמה — לכן משתמשים ב-fetch ישיר.
 * כותרות (Headers): ה-xi-api-key הוא פלייסיהולדר — OneCLI מזריק את המפתח האמיתי בפרוקסי.
 *
 * מודל v3 של ElevenLabs הכרחי עבור עברית (learnings 2026-05-13).
 * מחזיר ReadableStream<Uint8Array> עבור שימוש ב-MediaSource.
 *
 * timeout: withTimeout עוטף רק את ה-fetch (connect/first-response).
 * ברגע שה-response מגיע (headers), ה-timeout הסתיים והטיימר נוקה.
 * ה-stream (response.body) מוחזר אחרי כן ונצרך ע"י Speaker — לא נקטע ע"י ה-timeout.
 */

import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { beUrl } from "$lib/util/be-url"
import { ttsCacheHeaders } from "./cache-headers"

const TTS_CONNECT_TIMEOUT_MS = 10000

export interface TtsOptions {
  text: string
  voiceId: string
  modelId?: string
  messageId?: string | null
  signal?: AbortSignal
}

export async function synthesizeStreaming(opts: TtsOptions): Promise<ReadableStream<Uint8Array>> {
  // eleven_v3 הוא מודל ה-ElevenLabs היחיד שתומך בעברית (learnings 2026-05-13)
  const modelId = opts.modelId ?? "eleven_v3"

  // משלב slice 24 (x-cache-key דרך cacheHeaders) עם review-fixes-2 (withTimeout):
  const cacheHeaders = await ttsCacheHeaders(opts.text, opts.voiceId, modelId, opts.messageId ?? null)

  // withTimeout עוטף את ה-fetch בלבד (connect + קבלת headers).
  // ברגע ש-response מגיע, withTimeout resolve וה-timer נוקה (clearTimeout ב-finally).
  // ה-stream (response.body) מוחזר אחרי כן — לא מושפע מה-timeout.
  const response = await withTimeout(
    (s) =>
      fetch(beUrl(`/proxy/elevenlabs/v1/text-to-speech/${opts.voiceId}/stream`), {
        method: "POST",
        headers: {
          "xi-api-key": "browser-placeholder", // הפרוקסי של OneCLI מחליף במפתח האמיתי
          "content-type": "application/json",
          accept: "audio/mpeg",
          ...cacheHeaders,
        },
        body: JSON.stringify({
          text: opts.text,
          model_id: modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: s,
      }),
    TTS_CONNECT_TIMEOUT_MS,
    { signal: opts.signal, label: "tts-connect" },
  )

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`TTS failed: ${response.status} ${body}`)
  }
  if (!response.body) {
    throw new Error("TTS: no body in response")
  }

  // response.body נצרך אחרי שה-withTimeout הסתיים — הזרמה לא נקטעת
  return response.body
}
