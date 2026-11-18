/**
 * rpc-wait.ts — pure helpers for optional RPC response waiting (slice rpc-wait).
 *
 * No IO, no Hono. Used by rpc.ts when the caller passes top-level `waitMs`.
 */

export const MAX_RPC_WAIT_MS = 60_000

export type ParseWaitMsResult = number | null | "invalid"

/**
 * parseWaitMs — validates the top-level `waitMs` field from an RPC body.
 *
 * | Input              | Result    |
 * |--------------------|-----------|
 * | absent / null / 0  | null      | no wait — legacy 202 path
 * | 1..MAX_RPC_WAIT_MS | number    | wait that many ms
 * | anything else      | "invalid" | caller should return 400
 */
export function parseWaitMs(raw: unknown): ParseWaitMsResult {
  if (raw === undefined || raw === null || raw === 0) return null
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > MAX_RPC_WAIT_MS) {
    return "invalid"
  }
  return raw
}

export type RaceKeepRunningResult<T> =
  | { outcome: "resolved"; value: T }
  | { outcome: "rejected"; error: unknown }
  | { outcome: "timedOut" }

/**
 * raceKeepRunning — wait up to `ms` for `work` without cancelling it.
 *
 * The caller is a **watcher**, not an owner: a timeout does not abort the turn.
 * Both sides attach `.catch` before the timer fires so a late rejection after
 * timeout cannot become an unhandledRejection (see rpc.ts JSDoc + server.ts).
 */
export async function raceKeepRunning<T>(
  work: Promise<T>,
  ms: number,
  onLateSettle: (error: unknown) => void,
): Promise<RaceKeepRunningResult<T>> {
  let raceDone = false

  const workSide = new Promise<RaceKeepRunningResult<T>>((resolve) => {
    work
      .then((value) => {
        if (raceDone) return
        raceDone = true
        resolve({ outcome: "resolved", value })
      })
      .catch((error: unknown) => {
        if (raceDone) {
          onLateSettle(error)
          return
        }
        raceDone = true
        resolve({ outcome: "rejected", error })
      })
  })

  const timerSide = new Promise<RaceKeepRunningResult<T>>((resolve) => {
    setTimeout(() => {
      if (raceDone) return
      raceDone = true
      resolve({ outcome: "timedOut" })
    }, ms)
  })

  return Promise.race([workSide, timerSide])
}
