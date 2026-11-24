import { SSE_WATCHDOG_THRESHOLD_MS } from "$lib/engines/liveness-thresholds"
import { connWarn } from "$lib/util/conn-log"
import type { ClearIntervalFn, IntervalId, SetIntervalFn, SSEReaderOptions } from "./reader-types"

/** Maximum reconnect delay (ms). */
export const MAX_BACKOFF_MS = 30_000

/**
 * כמה זמן חיבור חייב לשרוד כדי שייחשב "הצלחה" לצורך איפוס ה-backoff.
 *
 * 🔴 נצפה חי (2026-08-16, ניתוק-קשה): `connectOnce` הצליח, ה-snapshot התקבל,
 * והחיבור נסגר **מיד** (`ERR_CONNECTION_CLOSED`). מכיוון שה-delay אופס ברגע
 * שהחיבור נפתח — לפני שידוע אם ישרוד — נוצרה לולאה צמודה: ניסיון כל שנייה,
 * בלי שום הסלמה, לנצח. בלוג נראו שני `sse-reconnected version=111` רצופים
 * עם `nextInMs=2000` ביניהם, בעוד כשלים *אמיתיים* כן הסלימו עד 16000.
 *
 * ⇒ שרת שמקבל-וסוגר (502 של Cloudflare · LB באמצע דיפלוי · פרוקסי שנופל)
 * הוא בדיוק המקרה שבו backoff נחוץ, והוא היחיד שבו הוא לא פעל.
 */
export const STABLE_CONNECTION_MS = 10_000

// ─── slice sse-liveness Commit 4: silence-watchdog ─────────────────────────
//
// The server already emits a visible liveness signal every 30s (Commit 2's
// `event: stream-alive`) — but nothing ever CONSUMED it: a stream that stays
// open and goes silent never triggers `#drainFrames` to end, so `#runLoop`'s
// reconnect logic (already complete — backoff, onReconnected, stable-
// connection reset) never runs. This watchdog is the missing trigger: it
// tracks the timestamp of the last frame RECEIVED (any frame — heartbeat or
// patch), and if too much time passes with nothing arriving, it aborts the
// in-flight request WITHOUT setting `#closed` — the exact same shape as an
// unexpected network drop, so it flows through the SAME reconnect path that
// already exists, unchanged.

export class ReaderWatchdog {
  readonly #describe: string
  readonly #now: () => number
  readonly #doSetInterval: SetIntervalFn
  readonly #doClearInterval: ClearIntervalFn

  // Timestamp of the last frame on the CURRENT connection (heartbeat or
  // patch — traffic is traffic). Only meaningful while the timer is running.
  #lastFrameAt = 0
  #watchdogTimer: IntervalId | null = null

  constructor(
    describe: string,
    now: () => number,
    opts: Pick<SSEReaderOptions, "_setInterval" | "_clearInterval">,
  ) {
    this.#describe = describe
    this.#now = now
    // Wrappers keep the browser's global receiver through injected timers.
    this.#doSetInterval = opts._setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms))
    this.#doClearInterval = opts._clearInterval ?? ((id) => globalThis.clearInterval(id))
  }

  /**
   * startWatchdog — called ONLY after a snapshot was actually received (both
   * on the initial connect and on every successful reconnect — never during
   * the snapshot wait itself, and never during backoff: "בזמן ה-backoff אין
   * זרם בדין; גלאי שירוץ שם יפעיל abort על חיבור שעוד לא נולד").
   *
   * Idempotent: always clears any previous timer first, so a stray double-
   * call can't leak a second interval.
   */
  start(abort: () => void): void {
    this.stop()
    this.#lastFrameAt = this.#now()
    // Ticks at the SAME cadence as the threshold itself — deliberately reuses
    // SSE_WATCHDOG_THRESHOLD_MS instead of introducing a second, separate
    // "how often do we check" magic number. Worst-case detection latency is
    // just under 2x the threshold (a silence that starts right after a tick
    // is caught on the NEXT tick) — acceptable for a last-resort backstop
    // whose only alternative today is an infinite hang.
    this.#watchdogTimer = this.#doSetInterval(() => {
      const silentMs = this.#now() - this.#lastFrameAt
      if (silentMs < SSE_WATCHDOG_THRESHOLD_MS) return
      connWarn("sse-silent", { url: this.#describe, silentMs })
      // Abort WITHOUT #closed — #drainFrames's catch-all swallows the abort
      // error and returns normally (see its doc comment), #runLoop sees
      // #closed is still false, and falls straight into the existing
      // reconnect loop. Three lines, no new reconnect logic.
      abort()
    }, SSE_WATCHDOG_THRESHOLD_MS)
  }

  stop(): void {
    if (this.#watchdogTimer !== null) {
      this.#doClearInterval(this.#watchdogTimer)
      this.#watchdogTimer = null
    }
  }

  /** Called on EVERY frame drained — heartbeat and patch alike (traffic is traffic). */
  touch(): void {
    this.#lastFrameAt = this.#now()
  }
}
