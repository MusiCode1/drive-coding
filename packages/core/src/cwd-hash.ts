/**
 * cwd-hash.ts — גיבוב SHA-256 דטרמיניסטי של נתיב תיקיית עבודה.
 *
 * משתמש ב-Web Crypto API (globalThis.crypto.subtle) הזמין
 * ב-Node 22.5+ ובכל הדפדפנים המודרניים — ללא ייבואים ייעודיים ל-Node.
 *
 * פורמט פלט: base64url, ללא ריפוד (בדיוק כמו ה-
 *   createHash('sha256').update(cwd).digest('base64url') של Node).
 *
 * זהו מקור האמת היחיד ל-cwdHash שמשמש גם את ה-BE וגם את ה-FE.
 * ב-BE היה קודם עותק מקומי ב-http-history.ts — שמוחלף עכשיו
 * על-ידי ייבוא זה.
 */

/** קידוד base64url ללא ריפוד (RFC 4648 §5). */
function toBase64Url(bytes: Uint8Array): string {
  // btoa זמין ב-Node 16+ ובדפדפנים
  let b64 = btoa(String.fromCharCode(...bytes))
  // החלפת תווי base64 למקבילים ב-base64url והסרת ריפוד
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * גיבוב נתיב תיקיית עבודה למחרוזת base64url בטוחה ל-URL.
 *
 * אסינכרוני בגלל ש-crypto.subtle.digest אסינכרוני ב-Web Crypto API.
 * בפועל זה לוקח ~מיקרו-שניות; בטוח להמתין לו בנתיבים חמים.
 */
export async function cwdToHash(cwd: string): Promise<string> {
  const data = new TextEncoder().encode(cwd)
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data)
  return toBase64Url(new Uint8Array(buf))
}
