/**
 * sse-snapshot-stream.ts — write chunked frame-zero to an SSE wire sink.
 */

import {
  type SessionState,
  serializeFrame,
  snapshotFrames,
} from "@drive-coding/core/session"

export type WriteSnapshotChunkFramesOpts = {
  maxBytes?: number
  /** @internal For testing — artificial gap between chunk writes (gzip arrival timing). Production leaves unset. */
  interFrameDelayMs?: number
}

export async function writeSnapshotChunkFrames(
  writeWire: (text: string) => Promise<void>,
  snapshot: SessionState,
  epoch: number,
  opts?: WriteSnapshotChunkFramesOpts,
): Promise<void> {
  const frames = snapshotFrames(
    snapshot,
    epoch,
    opts?.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : undefined,
  )
  for (const frame of frames) {
    await writeWire(serializeFrame(frame))
    const delayMs = opts?.interFrameDelayMs
    if (delayMs !== undefined && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
