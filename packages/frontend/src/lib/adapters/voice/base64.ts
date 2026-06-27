/**
 * base64.ts — המרה של Uint8Array ל-base64 במקטעים (chunks).
 *
 * ביקורת MED-5: הקריאה btoa(String.fromCharCode(...bytes)) זורקת שגיאת "Maximum call stack size exceeded"
 * עבור אודיו גדול מ-~100KB בגלל גלישת מחסנית (stack overflow) של ה-spread operator.
 * הודעות קוליות בעברית הן בגודל 30-300KB — בדיוק באזור המסוכן.
 *
 * פתרון: עיבוד במקטעים של 8192 בתים.
 *
 * הועתק כפי שהוא מ-main/packages/frontend/src/lib/voice/base64.ts (slice 3).
 */

/**
 * base64ToBytes — המרת מחרוזת base64 ל-Uint8Array.
 *
 * בלי spread — אותה זהירות כמו bytesToBase64 (ר' MED-5 למעלה).
 * משמש ל-decode של inlineData.data מ-Gemini TTS SSE stream.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
