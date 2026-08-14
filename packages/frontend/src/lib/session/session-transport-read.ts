/**
 * session-transport-read.ts — readSessionTransport(): פתירת הדגל + שמירת עקיפה.
 *
 * slice remote-warm-reconnect C4: נמשך מ-connect-agent.ts — אותו פתרון נחוץ גם
 * ל-handleReconnect ב-+page.svelte (מקור יחיד, לא שני עותקים).
 * slice transport-polish C2: נרמול לפני שמירה (זבל לא נשמר), חיווט שני מקורות
 * — sessionStorage → override (עקיפה, חיה בטאב), settings → stored (העדפה, קבועה).
 *
 * קדימות נעולה ב-resolveSessionTransport (query ← override ← stored ← env ← "ws");
 * כאן מתווסף ה-side-effect: query param נשמר ל-sessionStorage **מנורמל** — רק אם
 * normalizeSessionTransport(q) ≠ null. ערך פסול (banana) לא נשמר ולא דורס העדפה.
 *
 * טהור מספיק לטסטים: location/sessionStorage נקראים גלובלית (vi.stubGlobal),
 * ו-env/stored מוזרקים כפרמטרים (בלי יבוא $env/dynamic/public — לא זמין ב-vitest).
 */

import {
  normalizeSessionTransport,
  resolveSessionTransport,
  type SessionTransport,
} from "./session-transport.js"

/**
 * פותר את דגל sessionTransport: query ← override(sessionStorage) ←
 * stored(localStorage העדפה) ← env ← "ws". שומר את ה-query המנורמל ל-sessionStorage
 * (רק אם תקין) — הדגל שורד goto("/chat")/refresh; ערך פסול לא נשמר.
 *
 * `stored` — העדפה מ-localStorage (settings.sessionTransport). `null` = לא נבחרה
 * העדפה → הקדימות ממשיכה ל-env. (slice transport-polish §3)
 */
export function readSessionTransport(input: {
  env?: string
  stored?: string | null
}): SessionTransport {
  const q = new URLSearchParams(location.search).get("sessionTransport")
  const normalized = normalizeSessionTransport(q)
  if (normalized) sessionStorage.setItem("sessionTransport", normalized)
  return resolveSessionTransport({
    query: q,
    override: sessionStorage.getItem("sessionTransport"),
    stored: input.stored,
    env: input.env,
  })
}

