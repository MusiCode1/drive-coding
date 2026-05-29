/**
 * voices.ts — קטלוג קולות של ElevenLabs (דרך פרוקסי ב-BE ו-OneCLI).
 *
 * קריאת GET /v1/voices מחזירה את כל הספרייה הזמינה למפתח ה-API.
 * אנחנו חושפים רק את השדות שה-picker צריך; המבנה המקורי נשאר חופשי.
 *
 * הכותרת xi-api-key היא פלייסיהולדר — OneCLI מזריק את המפתח האמיתי בתוך
 * הפרוקסי. אותו דפוס כמו ב-tts.ts (learnings 2026-05-16).
 */

import { beUrl } from "$lib/util/be-url"

export type Voice = {
  voice_id: string
  name: string
  /** הקטגוריה ב-ElevenLabs — למשל "premade", "cloned", "professional", "generated" */
  category?: string
  /** תוויות אופציונליות (מבטא, גיל, מגדר, תיאורים…) */
  labels?: Record<string, string>
}

type VoicesResponse = {
  voices?: Voice[]
}

/**
 * רשימת הקולות הזמינים למפתח ה-API.
 * השגיאות מבעבעות למעלה — הקוראים (בדרך כלל VM) תופסים + מדפיסים ללוג.
 */
export async function listVoices(signal?: AbortSignal): Promise<Voice[]> {
  const res = await fetch(beUrl("/proxy/elevenlabs/v1/voices"), {
    method: "GET",
    headers: {
      "xi-api-key": "browser-placeholder", // OneCLI מחליף בפרוקסי
      accept: "application/json",
    },
    signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`listVoices failed: ${res.status} ${body}`)
  }

  const data = (await res.json()) as VoicesResponse
  return data.voices ?? []
}
