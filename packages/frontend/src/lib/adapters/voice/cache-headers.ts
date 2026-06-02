/**
 * cache-headers.ts — בוני headers לקאש של הפרוקסי (Slice 24).
 *
 * מבנה מפתחות:
 *   narrate  → `narrate:<toolCallId>`      (יציב; toolCallId לא תלוי בזמן)
 *   translate → `translate:<sha256(text|lang)>`
 *   tts       → `tts:<voiceId>:<sha256(text|modelId)>`
 *
 * messageId הוא UNSTABLE ב-ACP spec → metadata בלבד, אף פעם לא במפתח.
 * ה-meta (x-cache-meta) נשמר ב-BE לצורך מחיקה סלקטיבית עתידית.
 */

import { sha256Key } from "@drive-coding/core"

/**
 * בונה headers עבור קריאת narrate.
 * key = `narrate:${toolCallId}` (יציב גלובלית — ממרחב-שמות נפרד מ-messageId).
 */
export async function narrateCacheHeaders(
  toolCallId: string,
  toolKind: string | undefined,
): Promise<Record<string, string>> {
  if (!toolCallId) return {}
  const key = `narrate:${toolCallId}`
  const meta: Record<string, unknown> = {
    type: "narrate",
    toolCallId,
    createdAt: Date.now(),
  }
  if (toolKind !== undefined) {
    meta["toolKind"] = toolKind
  }
  return {
    "x-cache-key": key,
    "x-cache-meta": JSON.stringify(meta),
  }
}

/**
 * בונה headers עבור קריאת translate.
 * key = `translate:<sha256(text|targetLang)>` (טקסט+שפה הם ה-anchor היציב).
 * messageId הוא אופציונלי — metadata בלבד.
 */
export async function translateCacheHeaders(
  text: string,
  targetLang: string,
  messageId: string | null,
): Promise<Record<string, string>> {
  if (!text) return {}
  const textHash = await sha256Key(`${text}|${targetLang}`)
  const key = `translate:${textHash}`
  const meta: Record<string, unknown> = {
    type: "translate",
    textHash,
    targetLang,
    createdAt: Date.now(),
  }
  if (messageId !== null) {
    meta["messageId"] = messageId
  }
  return {
    "x-cache-key": key,
    "x-cache-meta": JSON.stringify(meta),
  }
}

/**
 * בונה headers עבור קריאת TTS.
 * key = `tts:<voiceId>:<sha256(text|modelId)>`.
 * messageId הוא אופציונלי — metadata בלבד.
 */
export async function ttsCacheHeaders(
  text: string,
  voiceId: string,
  modelId: string,
  messageId: string | null,
): Promise<Record<string, string>> {
  if (!text || !voiceId) return {}
  const textHash = await sha256Key(`${text}|${modelId}`)
  const key = `tts:${voiceId}:${textHash}`
  const meta: Record<string, unknown> = {
    type: "tts",
    voiceId,
    textHash,
    createdAt: Date.now(),
  }
  if (messageId !== null) {
    meta["messageId"] = messageId
  }
  return {
    "x-cache-key": key,
    "x-cache-meta": JSON.stringify(meta),
  }
}
