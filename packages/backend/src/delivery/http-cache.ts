/**
 * http-cache.ts — מטמון-תגובה בזיכרון (~1.5ש׳) לנקודות-קצה קריאה שהתשובה שלהן
 * תלויה במצב-בעלות (slice liveness C2).
 *
 * למה זה קיים: `/api/agents`, `/api/diag`, `/api/health` ותשובת ה-`presence`
 * נקראות בתדירות גבוהה (סקר 12ש׳ + פאנל), אבל הערך שלהן נגזר ממצב-בעלות שמשתנה
 * לעיתים רחוקות. המטמון סופג פרצי-קריאה (2 בקשות בחלון ⇒ דגימה אחת).
 *
 * 🔴 **ביטול-חובה** (DoD 12): המטמון מתבטל ב-`markOwned`/`markDetached` של
 * connection-registry (דרך `httpCacheInvalidateAll`) — אחרת הוא יגיש
 * `attached:true` אחרי פינוי, וזו בדיוק המחלה שהסלייס בא לרפא.
 *
 * ⚠️ התקדים: `http-tts-capabilities.ts:45` (מטמון-בזיכרון פר-מפתח). `proxy-cache.ts`
 * **אינו** מתאים — מטמון-דיסק לגופי POST.
 *
 * ⚠️ ה-`no-store` הנקודתי על ארבע התשובות חי בנקודות-הקצה עצמן (לא כאן) — גורף
 * היה דורס את `http-cli-logo.ts:105`.
 */

const CACHE_TTL_MS = 1500

type CacheEntry = { body: unknown; ts: number }

const cache = new Map<string, CacheEntry>()

/**
 * httpCacheGet — מחזיר את הגוף השמור, או undefined אם אין / פג-תוקף.
 * פג-תוקף מנקה את הערך מהמפה (אין הצטברות).
 */
export function httpCacheGet(key: string): unknown | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  return entry.body
}

/** httpCacheSet — שומר גוף תגובה למפתח. */
export function httpCacheSet(key: string, body: unknown): void {
  cache.set(key, { body, ts: Date.now() })
}

/**
 * httpCacheInvalidateAll — נקרא מ-connectionRegistry.markOwned/markDetached.
 * שינוי-בעלות פירושו שכל תשובה שנגזרת מ-attached/via פגה מיד.
 */
export function httpCacheInvalidateAll(): void {
  cache.clear()
}
