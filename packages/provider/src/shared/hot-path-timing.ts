/**
 * hot-path-timing.ts — threshold-based timing for the frame relay hot path.
 *
 * The relay (stream-bridge JSON.parse/stringify, spawn-core readline→subscribers,
 * writeStdin) is un-timed by default. When the BE hangs we currently have NO log
 * saying WHICH operation stalled. This adds one: measure a hot op, and log.warn only
 * when it exceeds a threshold (default 50ms, override HOTPATH_SLOW_MS). Near-zero
 * overhead in the happy path (a performance.now() diff + a compare), noisy only when
 * something actually blocks — e.g. `stringify took 800ms, bytes=10MB` points straight
 * at the culprit (validates/refutes the "large frame blocks the loop" theory).
 */

import { performance } from "node:perf_hooks"
import { createLogger } from "@drive-coding/core/log"

const log = createLogger("provider.hotpath")
const THRESHOLD_MS = Number(process.env.HOTPATH_SLOW_MS ?? 50)

/** Marks a start time. */
export function markStart(): number {
  return performance.now()
}

/** Logs a warning if the op since `startedAt` exceeded the threshold. */
export function logIfSlow(op: string, startedAt: number, meta?: Record<string, unknown>): void {
  const durationMs = performance.now() - startedAt
  if (durationMs > THRESHOLD_MS) {
    log.warn({ op, durationMs: Math.round(durationMs), ...meta }, "slow hot-path op")
  }
}
