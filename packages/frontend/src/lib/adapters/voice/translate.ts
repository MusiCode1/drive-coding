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
 * פסק זמן של 2500ms עם AbortController. מחזיר null בביטול/פסק זמן/שגיאה
 * (הקורא מתייחס ל-null כאל "דלג על התרגום, השתמש בטקסט המקורי").
 *
 * מודל: gemini-flash-lite-latest. זול, מהיר ודטרמיניסטי מספיק עבור
 * פרוזה קצרה. learnings 2026-05-16: משפחת gemini-2.0-flash יוצאת משימוש (deprecated)
 * עבור משתמשים חדשים — חובה להשתמש בכינויים מסוג `*-latest`.
 */

import { buildTranslationPrompt } from "@drive-coding/core/voice/translation-prompt"
import { generateObject, jsonSchema } from "ai"
import { googleAi } from "./sdks"

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
 */
export async function translate(
  text: string,
  targetLang: "he" | "en",
  signal?: AbortSignal,
): Promise<TranslateResult | null> {
  const basePrompt = buildTranslationPrompt(text, targetLang)
  const prompt = `${basePrompt}

Respond as JSON matching the schema:
- If the source is already in the target language, return {"status":"already_in_target"} (omit any text field).
- Otherwise, return {"status":"translated","text":"<the translated text>"}.`

  const ac = new AbortController()
  const timer = setTimeout(
    () => ac.abort(new Error(`Translate timeout ${TIMEOUT_MS}ms`)),
    TIMEOUT_MS,
  )
  signal?.addEventListener("abort", () => ac.abort(), { once: true })

  try {
    const result = await generateObject({
      model: googleAi("gemini-flash-lite-latest"),
      schema: translateSchema,
      prompt,
      abortSignal: ac.signal,
    })
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
  } finally {
    clearTimeout(timer)
  }
}
