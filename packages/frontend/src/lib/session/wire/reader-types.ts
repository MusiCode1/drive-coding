/**
 * The watchdog seam needs only "schedule a repeating callback, hand back
 * something cancellable". `typeof setInterval` here is the DOM ∪ Node overload
 * set, which no single implementation satisfies — it made the production
 * fallback below implicitly-`any` and forced `as unknown as` on every test
 * double. Narrow the seam to what the class actually calls.
 */
export type IntervalId = ReturnType<typeof setInterval>
export type SetIntervalFn = (fn: () => void, ms: number) => IntervalId
export type ClearIntervalFn = (id: IntervalId) => void

/** Options for SSEReader constructor. */
export type SSEReaderOptions = {
  /** HTTP headers to include in every fetch request (e.g. Authorization). */
  headers?: Record<string, string>
  /** @internal For testing — override global fetch. */
  _fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** @internal For testing — override setTimeout-based sleep. */
  _sleep?: (ms: number) => Promise<void>
  /** @internal For testing — override the clock used to measure connection lifetime. */
  _now?: () => number
  /**
   * @internal For testing — override the silence-watchdog's timer scheduler.
   * slice sse-liveness Commit 4a/4: same seam pattern as `_fetch`/`_sleep`/
   * `_now` — default = the real global, so production is unchanged.
   */
  _setInterval?: SetIntervalFn
  /** @internal For testing — override the silence-watchdog's timer cancel. */
  _clearInterval?: ClearIntervalFn
  /**
   * @internal For testing — override the snapshot-wait bound (default
   * `SNAPSHOT_TIMEOUT_MS` in `snapshot-timeout.ts`). Deliberately a plain number, not a `_sleep`-style
   * function seam: reusing `_sleep` here would make the timeout win EVERY
   * race instantly in the many existing tests that mock `_sleep` as an
   * instant no-op (it represents backoff delay, not this). A real (but tiny,
   * test-only) delay lets the timeout test use REAL timers instead of
   * `vi.useFakeTimers()` racing a `Promise.race` across several `await`
   * hops — a combination that produced spurious `PromiseRejectionHandled
   * Warning` noise (harmless per Node's own docs, but still noise) in this
   * exact codebase/runtime combination.
   */
  _snapshotTimeoutMs?: number
}
