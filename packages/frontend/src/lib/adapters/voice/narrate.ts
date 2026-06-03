/**
 * narrate.ts — מחולל משפט פרוזה קצר בעברית שמתאר קריאה לכלי (tool call).
 *
 * משתמש ב-generateText (מחרוזת פשוטה, לא JSON) דרך @ai-sdk/google → פרוקסי ב-BE.
 * הפרומפט נבנה על ידי buildNarratePrompt מתוך @drive-coding/core (כבר קיים).
 * ה-proxy-cache ב-BE תופס את קריאת ה-generateContent — אותו פרומפט בריענון → hit בזיכרון מטמון.
 *
 * פסק זמן (timeout) של 3000ms — דרך withTimeout (יישור ל-review-fixes-2).
 * מחזיר null במקרה של פסק זמן/שגיאה/ביטול (ה-UI מראה מצב טעינה).
 * מודל: gemini-flash-lite-latest (זול, מהיר, בעל יכולות בעברית).
 */

import { generateText } from "ai"
import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { googleAi } from "./sdks"
import { narrateCacheHeaders } from "./cache-headers"
import {
  buildNarratePrompt,
  type NarrateContext,
  type ToolCallForNarrate,
} from "@drive-coding/core/voice/narration-prompt"

const TIMEOUT_MS = 3000

/**
 * מחולל קריינות בעברית עבור קריאה לכלי.
 * מחזיר את המשפט בעברית, או null בכל שגיאה שהיא.
 * Slice 24: שולח x-cache-key + x-cache-meta לפי toolCallId (מפתח יציב).
 */
export async function narrate(
  ctx: NarrateContext,
  tool: ToolCallForNarrate,
  signal?: AbortSignal,
): Promise<string | null> {
  const prompt = buildNarratePrompt(ctx, tool)
  // משלב slice 24 (x-cache-key דרך cacheHeaders) עם review-fixes-2 (withTimeout):
  const cacheHeaders = await narrateCacheHeaders(tool.toolCallId, tool.kind)
  try {
    const result = await withTimeout(
      (s) =>
        generateText({
          model: googleAi("gemini-flash-lite-latest", cacheHeaders),
          prompt,
          abortSignal: s,
        }),
      TIMEOUT_MS,
      { signal, label: "narrate" },
    )
    const text = result.text.trim()
    if (text.length === 0) return null
    return text
  } catch (e) {
    console.warn("narrate failed", {
      err: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}
