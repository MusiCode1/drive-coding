export async function cacheKeyFor(text: string, voiceId: string, modelId: string): Promise<string> {
  const input = `${modelId}|${voiceId}|${text}`
  const buf = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * מחזיר תקציר SHA-256 מקודד כ-hex של הקלט הנתון.
 * גנרי — משמש את ה-FE לבניית מפתחות קאש ל-translate ו-TTS.
 * (הועבר מ-packages/backend/src/voice/cache-keys.ts שם לא היה בשימוש.)
 */
export async function sha256Key(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
