/**
 * sdks.ts — מפעלי SDK (factories) המוגדרים עבור הפרוקסי ב-BE שלנו.
 *
 * ביקורת CRIT-1: שני SDKs, שתי מוסכמות של אותיות רישיות (casing) שונות:
 *   @ai-sdk/google  → baseURL  (URL באותיות רישיות) — עבור generateText (תרגום, קריינות)
 *   @google/genai   → httpOptions.baseUrl (u באותיות קטנות) — עבור generateContent + multimodal (STT)
 *
 * שניהם עכשיו FACTORIES (פונקציות, לא קבועים consts): כל קריאה מפענחת את
 * ה-`beUrl()` הנוכחי כדי ששינויים ב-Settings.beUrl ייתפסו ללא הפעלה מחדש.
 * העלות (overhead) של יצירת provider לכל קריאה היא זניחה (~0.1ms).
 *
 * מפתח ה-API "browser-placeholder" הוא מכוון — הפרוקסי של OneCLI מחליף אותו
 * בשער (gateway). ראה learnings 2026-05-16: "OneCLI + AI SDK = placeholder apiKey pattern"
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { GoogleGenAI } from "@google/genai"
import { beUrl } from "$lib/util/be-url"

/**
 * עבור תרגום + קריינות — `generateText` / `generateObject` מתוך `@ai-sdk/google`.
 * הערה: ה-SDK הזה משתמש ב-`baseURL` (URL באותיות רישיות) — מתוך index.d.ts:494.
 * קוראים משתמשים ב: googleAi("gemini-flash-lite-latest")
 * אותה חתימת קריאה כמו קודם (היה provider קבוע, עכשיו מפעל) — אין
 * צורך בשינויים בקוראים.
 */
export function googleAi(model: string) {
  const provider = createGoogleGenerativeAI({
    apiKey: "browser-placeholder", // פלייסיהולדר; OneCLI מזריק את המפתח האמיתי בפרוקסי
    baseURL: beUrl("/proxy/google/v1beta"),
  })
  return provider(model)
}

/**
 * עבור STT (המרת דיבור לטקסט) — `generateContent` מולטימודאלי עם אודיו inline מתוך `@google/genai`.
 * חשוב: ה-SDK הזה משתמש ב-`httpOptions.baseUrl` (u באותיות קטנות) — מתוך web.d.ts:5904.
 * אותיות רישיות שגויות (`baseURL` במקום `baseUrl`) גורמות ל-SDK להתעלם מהאופציה
 * ולפנות ישירות ל-generativelanguage.googleapis.com → שגיאת CORS + שגיאת 401.
 * ה-baseUrl חייב להיות מוחלט (absolute) — ה-SDK מעביר אותו ל-`new URL()` באופן מיידי (eagerly).
 * `beUrl()` תמיד מחזיר URL מוחלט בדפדפן.
 * baseUrl חייב להסתיים ב-`/` לפני שה-SDK מוסיף את ה-apiVersion (`v1beta`).
 * קוראים משתמשים ב: googleGenAi().models.generateContent(...)
 */
export function googleGenAi(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: "browser-placeholder",
    httpOptions: { baseUrl: beUrl("/proxy/google/") },
  })
}
