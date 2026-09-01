/**
 * memory-guard.ts — RSS watchdog with 503 degradation for proxy routes.
 *
 * Slice: proxy-tap-memory (Commit 3)
 *
 * Polls process.memoryUsage().rss at a configurable interval.
 * When RSS exceeds the threshold, overBudget() returns true and the proxy
 * middleware returns HTTP 503 instead of attempting a new upstream request.
 *
 * This is a defense-in-depth measure: if the TransformStream approach
 * (Commits 1+2) fails to bound memory for any reason, the watchdog
 * prevents further requests from making it worse.
 *
 * Configuration:
 *   thresholdBytes — RSS budget (boot passes from config.rssBudgetMb)
 *   intervalMs — polling interval (default: 5000 ms)
 *
 * The timer is unref()d so it does not keep the process alive.
 */

import { configDefault } from "@drive-coding/core/config/specs"

const DEFAULT_INTERVAL_MS = 5_000

export interface MemoryGuard {
  /** Returns true if RSS has exceeded the budget threshold. */
  overBudget(): boolean
  /** RSS budget in megabytes (same threshold as proxy 503). */
  rssBudgetMB(): number
  /** Stops the polling interval (call on graceful shutdown). */
  stop(): void
}

export function createMemoryGuard(opts?: {
  thresholdBytes?: number
  intervalMs?: number
}): MemoryGuard {
  const thresholdBytes =
    opts?.thresholdBytes ?? configDefault("rssBudgetMb") * 1024 * 1024
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS

  let overBudgetFlag = false

  function poll() {
    try {
      const rss = process.memoryUsage().rss
      overBudgetFlag = rss > thresholdBytes
    } catch {
      // fail-safe: if memoryUsage() throws, don't falsely block requests
      overBudgetFlag = false
    }
  }

  // Poll immediately on creation, then on interval
  poll()
  const timer = setInterval(poll, intervalMs)
  // unref: do not keep process alive just for this timer
  timer.unref()

  return {
    overBudget(): boolean {
      return overBudgetFlag
    },
    rssBudgetMB(): number {
      return Math.round(thresholdBytes / 1024 / 1024)
    },
    stop(): void {
      clearInterval(timer)
    },
  }
}
