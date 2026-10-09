/**
 * sqlite-busy-retry.ts — async, deadline-bounded retry for SQLITE_BUSY (DoD 11).
 */

import { isSqliteBusyCause } from "./sqlite-adapter.js"

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const BACKOFF_MS = [25, 50, 100, 200, 400] as const

let lastRetryAttemptCount = 0

/** Test hook — attempts in the last completed `withSqliteBusyRetryUntil` call. */
export function getLastRetryAttemptCount(): number {
  return lastRetryAttemptCount
}

export function resetRetryAttemptCountForTests(): void {
  lastRetryAttemptCount = 0
}

function jitterMs(): number {
  return Math.floor(Math.random() * 10)
}

/**
 * Retries `fn` until success, non-busy error, or `deadlineAt`.
 * Does not start a new attempt after the deadline.
 */
export async function withSqliteBusyRetryUntil<T>(
  fn: () => T | Promise<T>,
  deadlineAt: number,
): Promise<T> {
  let attempt = 0
  let last: unknown
  while (Date.now() < deadlineAt) {
    attempt++
    try {
      const result = await fn()
      lastRetryAttemptCount = attempt
      return result
    } catch (e) {
      last = e
      if (!isSqliteBusyCause(e)) {
        lastRetryAttemptCount = attempt
        throw e
      }
      const remaining = deadlineAt - Date.now()
      if (remaining <= 0) {
        lastRetryAttemptCount = attempt
        throw e
      }
      const base = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] ?? 400
      const delay = Math.min(base + jitterMs(), remaining)
      if (delay <= 0) {
        lastRetryAttemptCount = attempt
        throw e
      }
      await sleepMs(delay)
    }
  }
  lastRetryAttemptCount = attempt
  throw last
}

export type BusyRetryOpts = {
  maxAttempts?: number
  delayMs?: number
  maxTotalMs?: number
}

/** @deprecated Prefer `withSqliteBusyRetryUntil` with an absolute deadline. */
export async function withSqliteBusyRetry<T>(
  fn: () => T | Promise<T>,
  opts?: BusyRetryOpts,
): Promise<T> {
  const maxTotalMs = opts?.maxTotalMs ?? 1000
  return withSqliteBusyRetryUntil(fn, Date.now() + maxTotalMs)
}
