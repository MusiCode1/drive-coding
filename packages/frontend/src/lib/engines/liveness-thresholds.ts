/**
 * liveness-thresholds.ts — כל ספי-הזמן של גילוי-חיים בצד ה-FE, במקום אחד.
 *
 * לפני הקובץ הזה, כל צרכן החזיק את הסף שלו כליטרל מקומי — לא ריכוז, שכפול:
 * `turn-watchdog.ts` (STALL_NOTICE_MS/STALL_HARD_CAP_MS), `presence-poller.
 * svelte.ts` (PRESENCE_INTERVAL_MS/PRESENCE_BANNER_DELAY_MS), ובקרוב
 * `sse-reader.ts` (Commit 4 — סף-השתיקה של הגלאי, שמייבא **מכאן** את
 * `SSE_WATCHDOG_THRESHOLD_MS`, ולכן חייב להיכתב **אחרי** הקובץ הזה).
 *
 * שני הצרכנים הקיימים לא נמחקו — הם **מייצאים-מחדש** מכאן (`export { X } from
 * "$lib/engines/liveness-thresholds"`), כדי לא לשבור את 21 מקומות-הצריכה
 * (turn-watchdog.test.ts 9 + presence-poller.test.svelte.ts 12) שמייבאים אותם
 * דרך הקבצים המקוריים.
 *
 * ⚠️ שער-grep (DoD, Commit 4ב) רץ על שלושה קבצים בלבד: turn-watchdog.ts ·
 * presence-poller.svelte.ts · session/sse-reader.ts — לא מעבר. `LIVENESS_FRESH_MS`
 * (adapters/liveness-state.ts) הוא סף אחר, לא בסקופ; formatting.ts מלא
 * ב-3_600_000 מסיבות אחרות.
 *
 * ─── slice sse-liveness Commit 4ב (TDD) ───
 */

import { STREAM_ALIVE_INTERVAL_MS } from "@drive-coding/core/session"

/**
 * קצב שידור ה-`event: stream-alive` של השרת — **מקור-האמת** הוא
 * `packages/core/src/session/stream-alive.ts` (Commit 1); שם מקומי כאן
 * לבהירות-קריאה בהקשר-FE (הצרכן הוא הגלאי, לא ה-BE).
 */
export const SERVER_KEEPALIVE_MS = STREAM_ALIVE_INTERVAL_MS

// ─── turn-watchdog.ts ───────────────────────────────────────────────────────

/** אחרי כמה זמן בלי פעילות בתור פעיל להציג חיווי. */
export const STALL_NOTICE_MS = 90_000

/**
 * חסם עליון על תור שלא נענה — רשת-ביטחון בלבד, שלא ידלוף לנצח.
 * גם כאן: החסם משחרר את ההמתנה שלנו, ואינו שולח `session/cancel` לסוכן.
 */
export const STALL_HARD_CAP_MS = 600_000

// ─── presence-poller.svelte.ts ──────────────────────────────────────────────

/** קצב הסקר (POST /api/agents/:id/presence). */
export const PRESENCE_INTERVAL_MS = 12_000

/** השהיה לפני הצגת באנר-ניתוק (חסד לפני שמטרידים את המשתמש). */
export const PRESENCE_BANNER_DELAY_MS = 5_000

// ─── session/sse-reader.ts (Commit 4) ───────────────────────────────────────

/**
 * סף-השתיקה של גלאי-ה-SSE: `SERVER_KEEPALIVE_MS × 2.5`. חייב להיות **גדול**
 * מ-`SERVER_KEEPALIVE_MS` — אחרת הגלאי היה יורה על keepalive תקין לגמרי.
 * הכפלה ב-2.5 (ולא 1, 2, או 3) נותנת מרווח־ביטחון מעל תזמון-לא-מושלם של
 * setInterval (עומס/רקע) בלי לתת לזרם שקט "יותר מדי" זמן.
 */
export const SSE_WATCHDOG_THRESHOLD_MS = SERVER_KEEPALIVE_MS * 2.5

// ─── סדר-ספים ────────────────────────────────────────────────────────────────

export type ThresholdCheckResult = { ok: true } | { ok: false; reason: string }

/**
 * checkThresholdOrder — טהורה: מקבלת ספים כפרמטרים (לא קוראת את הקבועים
 * שמעל ישירות) כדי שהיא תהיה ניתנת-לבדיקה גם על ערכים שגויים-בכוונה.
 */
export function checkThresholdOrder(thresholds: {
  serverKeepaliveMs: number
  sseWatchdogThresholdMs: number
  stallNoticeMs: number
  stallHardCapMs: number
  presenceBannerDelayMs: number
  presenceIntervalMs: number
}): ThresholdCheckResult {
  const {
    serverKeepaliveMs,
    sseWatchdogThresholdMs,
    stallNoticeMs,
    stallHardCapMs,
    presenceBannerDelayMs,
    presenceIntervalMs,
  } = thresholds

  if (sseWatchdogThresholdMs <= serverKeepaliveMs) {
    return {
      ok: false,
      reason:
        "sseWatchdogThresholdMs must be greater than serverKeepaliveMs — otherwise the SSE watchdog would fire on a perfectly healthy keepalive cadence",
    }
  }
  if (stallNoticeMs >= stallHardCapMs) {
    return {
      ok: false,
      reason:
        "stallNoticeMs must be less than stallHardCapMs — the notice must fire before the give-up hard cap",
    }
  }
  if (presenceBannerDelayMs >= presenceIntervalMs * 10) {
    return {
      ok: false,
      reason:
        "presenceBannerDelayMs is absurdly larger than presenceIntervalMs — the banner grace period should be on the order of a few poll intervals, not tens of them",
    }
  }
  return { ok: true }
}

// Self-check on the real constants above — fails fast (at import time) if a
// future edit puts two thresholds in the wrong relative order, instead of
// silently shipping a watchdog that fires on healthy traffic (or never).
const selfCheck = checkThresholdOrder({
  serverKeepaliveMs: SERVER_KEEPALIVE_MS,
  sseWatchdogThresholdMs: SSE_WATCHDOG_THRESHOLD_MS,
  stallNoticeMs: STALL_NOTICE_MS,
  stallHardCapMs: STALL_HARD_CAP_MS,
  presenceBannerDelayMs: PRESENCE_BANNER_DELAY_MS,
  presenceIntervalMs: PRESENCE_INTERVAL_MS,
})
if (!selfCheck.ok) {
  throw new Error(`liveness-thresholds: invalid threshold order — ${selfCheck.reason}`)
}
