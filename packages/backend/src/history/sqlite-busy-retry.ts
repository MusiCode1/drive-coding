/**
 * sqlite-busy-retry.ts — async, time-bounded retry for SQLITE_BUSY (DoD 11).
 * No sync sleep — does not block the event loop for long waits.
 */

import { isSqliteBusyCause } from "./sqlite-adapter.js"

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export type BusyRetryOpts = {
  maxAttempts?: number
  delayMs?: number
  maxTotalMs?: number
}

const DEFAULT_OPTS: Required<BusyRetryOpts> = {
  maxAttempts: 5,
  delayMs: 40,
  maxTotalMs: 2000,
}

/**
 * Runs `fn` with retries when the thrown/rejected error is SQLITE_BUSY.
 * Returns undefined if all attempts fail (caller decides fail-open vs propagate).
 */
export async function withSqliteBusyRetry<T>(
  fn: () => T | Promise<T>,
  opts?: BusyRetryOpts,
): Promise<T> {
  const o = { ...DEFAULT_OPTS, ...opts }
  const deadline = Date.now() + o.maxTotalMs
  let last: unknown
  for (let attempt = 0; attempt < o.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (!isSqliteBusyCause(e) || Date.now() >= deadline) throw e
      await sleepMs(o.delayMs)
    }
  }
  throw last
}
