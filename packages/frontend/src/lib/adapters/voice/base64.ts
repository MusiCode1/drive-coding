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

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
