/**
 * session-transport-read.ts — readSessionTransport(): פתירת הדגל + שמירה.
 *
 * slice remote-warm-reconnect C4: נמשך מ-connect-agent.ts (:33-41) — אותה פתרון
 * נחוץ גם ל-handleReconnect ב-+page.svelte (מקור יחיד, לא שני עותקים).
 * קדימות נעולה ב-resolveSessionTransport (query ← stored ← env ← local); כאן
 * מתווסף ה-side-effect: query param נשמר ל-sessionStorage (הדגל לא שורד
 * goto("/chat")/refresh — בלי זה המשתמשת הייתה מתחברת ב-local בלי לדעת).
 *
 * טהור מספיק לטסטים: location/sessionStorage נקראים גלובלית (vi.stubGlobal),
 * ו-env מוזרק כפרמטר (בלי יבוא $env/dynamic/public — לא זמין ב-vitest).
 */

import { resolveSessionTransport, type SessionTransport } from "./session-transport.js"

/**
 * פותר את דגל sessionTransport בדיוק כמו connect-agent.ts המקורי:
 * query ← stored ← env ← "local". אם יש query param — גם שומר ל-sessionStorage.
 */
export function readSessionTransport(envValue: string | undefined): SessionTransport {
  const q = new URLSearchParams(location.search).get("sessionTransport")
  if (q) sessionStorage.setItem("sessionTransport", q)
  return resolveSessionTransport({
    query: q,
    stored: sessionStorage.getItem("sessionTransport"),
    env: envValue,
  })
}
