/**
 * translate.ts — תרגום טקסט דרך מודל Gemini Flash Lite (דרך הפרוקסי ב-BE).
 *
 * משתמש ב-generateObject עם סכמת JSON של discriminated-union כך שמודל Gemini יכול
 * לאותת "כבר בשפת היעד" עם מטען מינימלי, וכך לחסוך ניסוח מחדש מיותר ובזבוז טוקני פלט.
 *
 * Slice 2: ללא שכבת זיכרון מטמון של localStorage ב-FE — הפרוקסי ב-BE כבר שומר במטמון
 * את ה-`generateContent` (ראה packages/backend/src/delivery/proxy-cache.ts). אם
 * נזדקק בעתיד לתמיכה באופליין, נוכל להחזיר שכבה דקה של localStorage.
 *
 * review-fixes-1 (Commit 3): מחליף AbortController+setTimeout ידני ב-withTimeout.
 * ה-ai SDK תומך ב-abortSignal — ה-signal עושה גם ביטול-רשת אמיתי וגם race מגן.
 * מחזיר null בביטול/פסק זמן/שגיאה (הקורא מתייחס ל-null כאל "דלג על התרגום").
 *
 * מודל: gemini-flash-lite-latest. זול, מהיר ודטרמיניסטי מספיק עבור
 * פרוזה קצרה. learnings 2026-05-16: משפחת gemini-2.0-flash יוצאת משימוש (deprecated)
 * עבור משתמשים חדשים — חובה להשתמש בכינויים מסוג `*-latest`.
 */

import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { buildTranslationPrompt } from "@drive-coding/core/voice/translation-prompt"
import type { VoiceModelRef } from "@drive-coding/core/voice/capabilities"
import { generateObject, jsonSchema } from "ai"
import { googleAi } from "./sdks"
import { translateCacheHeaders } from "./cache-headers"

const TIMEOUT_MS = 2500

export type TranslateResult =
  | { status: "already_in_target" }
  | { status: "translated"; text: string }

/**
 * סכמת JSON הנאכפת על ידי ה-responseSchema של Gemini. ה-anyOf נותן לנו union
 * אמיתי (discriminated) — כאשר המקור הוא כבר בעברית, Gemini פולט
 * `{"status":"already_in_target"}` (~6 טוקנים) במקום לחזור על
 * הטקסט המקורי.
 */
const translateSchema = jsonSchema<TranslateResult>({
  anyOf: [
    {
      type: "object",
      properties: {
        status: { type: "string", enum: ["already_in_target"] },
      },
      required: ["status"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { type: "string", enum: ["translated"] },
        text: { type: "string" },
      },
      required: ["status", "text"],
      additionalProperties: false,
    },
  ],
})

/**
 * מתרגם את `text` ל-`targetLang`. מחזיר:
 *   - { status: "translated", text } כאשר Gemini הפיק תרגום
 *   - { status: "already_in_target" } כאשר המקור היה כבר בשפת היעד
 *   - null במקרה של ביטול (abort), פסק זמן, או כל שגיאה אחרת
 * Slice 24: שולח x-cache-key + x-cache-meta לפי sha256(text|lang) (מפתח יציב).
 * messageId אופציונלי — metadata בלבד (UNSTABLE ב-ACP spec).
 */
export async function translate(
  text: string,
  targetLang: "he" | "en",
  ref: VoiceModelRef,
  signal?: AbortSignal,
  messageId?: string | null,
): Promise<TranslateResult | null> {
  const basePrompt = buildTranslationPrompt(text, targetLang)
  const prompt = `${basePrompt}

Respond as JSON matching the schema:
- If the source is already in the target language, return {"status":"already_in_target"} (omit any text field).
- Otherwise, return {"status":"translated","text":"<the translated text>"}.`

  // משלב slice 24 (x-cache-key) עם review-fixes-1 (withTimeout):
  // ה-cacheHeaders עוברים ל-model, וה-withTimeout עוטף ומספק abort+timeout.
  const cacheHeaders = await translateCacheHeaders(text, targetLang, messageId ?? null)

  try {
    const result = await withTimeout(
      (signal) =>
        generateObject({
          model: googleAi(ref.model, cacheHeaders), // V2: switch on ref.provider (google|openai)
          schema: translateSchema,
          prompt,
          abortSignal: signal,
        }),
      TIMEOUT_MS,
      { signal, label: "translate" },
    )
    const obj = result.object

    // התייחס לטקסט ריק מתורגם כאל כישלון כדי למנוע TTS של שקט בהמשך התהליך.
    if (obj.status === "translated" && obj.text.trim().length === 0) {
      console.warn("translate returned empty text — treating as failure", { len: text.length })
      return null
    }
    return obj
  } catch (e) {
    console.warn("translate failed", {
      err: e instanceof Error ? e.message : String(e),
      len: text.length,
    })
    return null
  }
}
