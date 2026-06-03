/**
 * transcribe.ts — המרת דיבור לטקסט דרך Gemini multimodal (אודיו inline).
 *
 * משתמש ב-@google/genai (ולא ב-@ai-sdk/google) כי הוא צריך את generateContent
 * עם חלקי אודיו מסוג inlineData — החבילה @ai-sdk/google לא תומכת באודיו מולטימודאלי.
 *
 * מזהה CRIT-1: האובייקט googleGenAi משתמש ב-httpOptions.baseUrl (עם u קטנה) — ראה sdks.ts.
 * מלכודת תעתיק (transliteration) בעברית (learnings 2026-05-16): מודל Gemini מחזיר אותיות לטיניות
 * כברירת מחדל. חייבים לבקש במפורש כתב עברי בפרומפט.
 *
 * הועתק מתוך main/packages/frontend/src/lib/voice/stt-client.ts (slice 3).
 * שינויים:
 *   (a) הוסר `import { saveRecording } from "./recordings-client"`
 *   (b) קריאת saveRecording הוחלפה ב-Promise.resolve({ id: "" })
 *   (c) ייבוא של googleGenAi מתוך "./sdks" נשאר ללא שינוי (sdks.ts קיים החל מ-slice 2)
 *   (d) slice sessions-inline: timeout 15s→30s, עטוף withRetry (3 נסיונות, backoff 800ms)
 *   (e) slice model-status-control-replay: הסרת stub; קריאת saveRecording אמיתית (best-effort)
 */

import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { withRetry } from "@drive-coding/core/async/with-retry"
import { bytesToBase64 } from "./base64"
import { googleGenAi } from "./sdks"
import { saveRecording } from "./recordings"

const TRANSCRIBE_TIMEOUT_MS = 30000 // הוגדל מ-15s: תמלול ארוך + thinking model

export async function transcribe(
  blob: Blob,
  opts: {
    previousAssistantText?: string
    signal?: AbortSignal
  } = {},
): Promise<{ text: string; recordingId: string }> {
  const audioBytes = new Uint8Array(await blob.arrayBuffer())
  const mimeType = blob.type || "audio/webm"

  // שמירת הקלטה ל-BE (best-effort) — כושל לא מפיל את התמלול.
  // רץ במקביל לתמלול (Promise.race לא — רק await בסוף).
  const recordingPromise = saveRecording(blob, { signal: opts.signal }).catch(() => ({ id: "" }))

  // תיקון תעתיק לעברית: הוראה מפורשת להוציא כתב עברי
  const hebrewRule =
    "Output in the original script of the language spoken. If Hebrew, output Hebrew letters."
  const prompt = opts.previousAssistantText
    ? `Transcribe the user's audio. Context: previous assistant said: "${opts.previousAssistantText}". Transcribe ONLY user's audio. ${hebrewRule}`
    : `Transcribe the audio. ${hebrewRule}`

  // ביקורת MED-5: המרה ל-base64 במקטעים
  const base64 = bytesToBase64(audioBytes)

  // withRetry עוטף withTimeout: כל נסיון מקבל timeout 30s משלו.
  // signal מועבר לשתי השכבות: withRetry (לביטול בין נסיונות) + withTimeout (לביטול בתוך נסיון).
  const response = await withRetry(
    () =>
      withTimeout(
        (signal) =>
          googleGenAi().models.generateContent({
            model: "gemini-flash-latest",
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
              },
            ],
            config: { abortSignal: signal } as Record<string, unknown>, // best-effort: @google/genai לא מובטח שמכבד abort
          }),
        TRANSCRIBE_TIMEOUT_MS,
        { signal: opts.signal, label: "transcribe" },
      ),
    { retries: 3, baseDelayMs: 800, maxDelayMs: 4000, signal: opts.signal, label: "transcribe" },
  )

  const { id: recordingId } = await recordingPromise
  const text = response.text ?? ""
  return { text, recordingId }
}
