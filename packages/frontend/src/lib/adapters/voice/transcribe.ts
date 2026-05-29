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
 * הפונקציה saveRecording הוסרה (slice 10 יוסיף את ה-endpoint ב-BE). מחזיר
 * כרגע recordingId: "" כפלייסיהולדר — slice 10 יחליף בקריאה האמיתית.
 *
 * הועתק מתוך main/packages/frontend/src/lib/voice/stt-client.ts (slice 3).
 * שינויים:
 *   (a) הוסר `import { saveRecording } from "./recordings-client"`
 *   (b) קריאת saveRecording הוחלפה ב-Promise.resolve({ id: "" })
 *   (c) ייבוא של googleGenAi מתוך "./sdks" נשאר ללא שינוי (sdks.ts קיים החל מ-slice 2)
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

  // פלייסיהולדר (Stub): slice 10 יחליף את זה בקריאה האמיתית ל-saveRecording
  const recordingPromise = Promise.resolve({ id: "" })

  // תיקון תעתיק לעברית: הוראה מפורשת להוציא כתב עברי
  const hebrewRule =
    "Output in the original script of the language spoken. If Hebrew, output Hebrew letters."
  const prompt = opts.previousAssistantText
    ? `Transcribe the user's audio. Context: previous assistant said: "${opts.previousAssistantText}". Transcribe ONLY user's audio. ${hebrewRule}`
    : `Transcribe the audio. ${hebrewRule}`

  // ביקורת MED-5: המרה ל-base64 במקטעים
  const base64 = bytesToBase64(audioBytes)

  const response = await googleGenAi().models.generateContent({
    model: "gemini-flash-latest",
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
      },
    ],
    // העברת abortSignal דרך ה-config אם נתמך על ידי גרסת ה-SDK הזו
    config: opts.signal ? ({ abortSignal: opts.signal } as Record<string, unknown>) : undefined,
  })

  const { id: recordingId } = await recordingPromise
  const text = response.text ?? ""
  return { text, recordingId }
}
