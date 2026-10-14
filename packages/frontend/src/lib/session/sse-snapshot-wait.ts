/**
 * sse-snapshot-wait.ts — bounded wait and incremental fold for chunked frame-zero.
 *
 * slice sse-frame-zero-chunked-gzip: extracted from sse-reader.ts so the reader
 * class stays within the session-layer size ratchet while snapshot chunking grows.
 */

import {
  createInitialSessionState,
  reduce,
  type SessionState,
  STREAM_ALIVE_EVENT,
  type WireSessionUpdate,
} from "@drive-coding/core/session"

/** גוף ה-snapshot (frame-zero). */
export type WireSnapshot = {
  sessionId: string | null
  version: number
  updates: WireSessionUpdate[]
  chunk?: { i: number; more: boolean }
}

export type SnapshotSseFrame = { event: string; data: string; id: string }

/** מקפל את ה-snapshot למצב. ה-`version` נלקח מהשרת, לא מספירת ה-updates. */
export function foldSnapshot(snap: WireSnapshot, initial?: SessionState): SessionState {
  let state = initial ?? createInitialSessionState({ sessionId: snap.sessionId ?? "" })
  for (const u of snap.updates) state = reduce(state, u).state
  return { ...state, sessionId: snap.sessionId, version: snap.version }
}

/**
 * awaitFrameBounded — one frame from the generator, bounded by `ms`.
 *
 * Both sides get a no-op `.catch` attached IMMEDIATELY (same tick, before
 * racing) — whichever one LOSES the race may still reject later on its
 * own (e.g. `advance` rejecting after `close()` aborts, post-timeout;
 * or — in principle — `timeout` firing after `advance` already won).
 * `Promise.race` never attaches a handler to the losing side, so without
 * this a later rejection is "unhandled" even though nothing is meant to
 * observe it anymore. `Promise.race([advance, timeout])` below still
 * independently determines the actual return value.
 */
export async function awaitFrameBounded(
  frames: AsyncGenerator<SnapshotSseFrame>,
  ms: number,
): Promise<SnapshotSseFrame> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = (async (): Promise<never> => {
    await new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, ms)
    })
    throw new Error("SSEReader: timed out waiting for snapshot frame")
  })()
  const advance = (async (): Promise<SnapshotSseFrame> => {
    const next = await frames.next()
    if (next.done) {
      throw new Error("SSEReader: no snapshot frame received")
    }
    return next.value
  })()
  advance.catch(() => {})
  timeout.catch(() => {})
  try {
    return await Promise.race([advance, timeout])
  } finally {
    clearTimeout(timeoutId)
  }
}

/** Accumulates chunked (or single) snapshot frames into one SessionState. */
export async function waitForSnapshotFromFrames(
  frames: AsyncGenerator<SnapshotSseFrame>,
  timeoutMs: number,
): Promise<SessionState> {
  let folded: SessionState | undefined
  while (true) {
    const frame = await awaitFrameBounded(frames, timeoutMs)
    if (frame.event === STREAM_ALIVE_EVENT) continue
    if (frame.event !== "snapshot") {
      throw new Error(
        `SSEReader: unexpected ${frame.event} frame while waiting for snapshot chunks`,
      )
    }
    const snap = JSON.parse(frame.data) as WireSnapshot
    const isFinal = snap.chunk === undefined || snap.chunk.more === false
    folded = foldSnapshot(snap, folded)
    if (isFinal) return folded
  }
}
