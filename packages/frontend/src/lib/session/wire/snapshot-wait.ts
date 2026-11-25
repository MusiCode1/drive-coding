import type { ChannelFrame } from "@drive-coding/core/session"
import { readSnapshotTimeoutMs } from "../snapshot-timeout"
import { decodeOpeningFrame, type OpeningFrame } from "./frame-decode"

/**
 * ‏הגבול על המתנה ל-snapshot ‏חי ב-`snapshot-timeout.ts` ‏— ‏שם גם שני ערוצי
 * ‏העקיפה מהדפדפן (‏`window.__dcSnapshotTimeoutMs` ‏· ‏`localStorage`) ‏והסיבה
 * ‏שהם מוגבלים ל-`2^31-1`. ‏נקרא כאן פעם אחת, ‏בבנאי.
 *
 * ‏slice sse-liveness Commit 4 — ‏**‏למה הוא קיים בכלל:** ‏חיבור שנפתח בהצלחה
 * ‏(‏ה-fetch ‏נפתר ok) ‏ואינו שולח `snapshot` ‏לעולם — ‏פרוקסי שמתנהג רע, ‏או
 * ‏מארח שמקבל את הבקשה ואינו כותב דבר — ‏תלה את `#connectOnce` ‏**‏לנצח**:
 * ‏מחוץ ללולאת-ה-patches ‏ולכן גלאי-השתיקה שלמטה אינו רואה אותו, ‏ובחיבור
 * ‏הראשון גם לפני ש-`#runLoop` ‏קיים, ‏ולכן שום דבר לא היה מנסה מחדש.
 *
 * ‏אינו קשור ל-`SSE_WATCHDOG_THRESHOLD_MS`: ‏זה חוסם שתיקה על זרם שכבר
 * ‏**‏פתוח**, ‏אחרי ה-snapshot; ‏הגבול הזה חוסם את לחיצת-היד עצמה, ‏ובברירת-המחדל
 * ‏נשאר מתחתיו (60s < 75s) ‏כדי שזרם שכן נפתח יישפט ע"י הגלאי ולא ע"י הגבול.
 *
 * ‏🔴 ‏ברירת-המחדל הועלתה 2026-10-31 ‏מ-15s ‏ל-60s: ‏הערך הקודם ירה בפועל על
 * ‏חיבורים תקינים (`timed out waiting for snapshot frame` ‏חזר ונשנה), ‏כלומר
 * ‏היה קצר מזמן-ההינע האמיתי והפך שער-הגנה לכשל-שווא. ‏⚠️ ‏זמן-ההינע עצמו
 * ‏**‏לא נמדד**; ‏60s ‏הוא 4× ‏מהקודם, ‏לא תוצאה של מדידה — ‏ומכאן ערוצי-העקיפה.
 */
export function snapshotWaitMs(override?: number): number {
  return override ?? readSnapshotTimeoutMs()
}

/**
 * waitForSnapshot — advances past any non-snapshot frames to find the
 * required snapshot frame-zero, bounded by the value resolved in
 * `snapshot-timeout.ts` (see its
 * doc comment for why: a connection that never sends `snapshot` used to
 * hang here forever, invisible to both the watchdog and — on the initial
 * connection — the reconnect loop).
 *
 * ⚠️ Deliberately uses the RAW global `setTimeout`/`clearTimeout`, not the
 * `#sleep` seam: `#sleep` is mocked as an INSTANT no-op in almost every
 * reader test (it represents backoff delay, which tests skip) — if
 * this raced against `#sleep(snapshotTimeoutMs)`, the timeout branch
 * would win EVERY race immediately, breaking every existing test. The raw
 * timer is safe here because `advance` below always resolves within a few
 * microtasks in every test that isn't specifically testing this timeout
 * (which injects a short timeout). The default timer is cleared once the race
 * settles.
 */
export async function waitForSnapshot(
  frames: AsyncIterator<ChannelFrame>,
  snapshotTimeoutMs: number,
): Promise<OpeningFrame> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = (async (): Promise<never> => {
    await new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, snapshotTimeoutMs)
    })
    throw new Error("SSEReader: timed out waiting for snapshot frame")
  })()
  const advance = (async (): Promise<OpeningFrame> => {
    let next = await frames.next()
    while (!next.done && next.value.event !== "snapshot") {
      next = await frames.next()
    }
    if (next.done || next.value.event !== "snapshot") {
      throw new Error("SSEReader: no snapshot frame received")
    }
    return decodeOpeningFrame(next.value)
  })()
  // Both sides get a no-op `.catch` attached IMMEDIATELY (same tick, before
  // racing) — whichever one LOSES the race may still reject later on its
  // own (e.g. `advance` rejecting after `close()` aborts, post-timeout;
  // or — in principle — `timeout` firing after `advance` already won).
  // The race determines the result independently of these handlers.
  advance.catch(() => {})
  timeout.catch(() => {})
  try {
    return await Promise.race([advance, timeout])
  } finally {
    clearTimeout(timeoutId)
  }
}
