/**
 * isEnabledForNs — בודק אם מרחב שם תואם לתבנית CSV הנתונה.
 *
 * תחביר תבנית (מופרד בפסיקים):
 *   *              — תואם להכל
 *   voice.*        — התאמת קידומת: voice, voice.pipeline, voice.pipeline.tts
 *                    אבל לא voicemail (חייב להיות קידומת מדויקת או עם "." אחריה)
 *   voice.pipeline — התאמה מדויקת בלבד (לא תואם ל-voice.pipeline.tts)
 *   -noisy.x       — החרגה (חזקה יותר מהכללה)
 *
 * תבנית ריקה/לא חוקית → נופל ל-"*" (תואם להכל).
 */
export function isEnabledForNs(ns: string, pattern: string): boolean {
  if (!ns || !pattern || pattern.trim() === "") return true

  const parts = pattern
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return true

  let included = false
  let excluded = false

  for (const part of parts) {
    if (part.startsWith("-")) {
      const excl = part.slice(1)
      if (matchSingle(ns, excl)) excluded = true
    } else {
      if (matchSingle(ns, part)) included = true
    }
  }

  // "*" לבדו — כלול הכל כברירת מחדל אם אין הכללה מפורשת
  const hasAnyInclude = parts.some((p) => !p.startsWith("-"))
  if (!hasAnyInclude) return !excluded

  return included && !excluded
}

function matchSingle(ns: string, pattern: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2)
    // תואם בדיוק לקידומת או לקידומת מלווה ב-"."
    return ns === prefix || ns.startsWith(`${prefix}.`)
  }
  // התאמה מדויקת
  return ns === pattern
}
