import { FrameReader } from "./wire/frame-reader"
import type { SSEReaderOptions } from "./wire/reader-types"
import { createSseFramePipe } from "./wire/sse-pipe"

export type { OpeningFrame, WireUpdateBatch } from "./wire/frame-decode"
export { connectionOf } from "./wire/frame-reader"
export type {
  ClearIntervalFn,
  IntervalId,
  SetIntervalFn,
  SSEReaderOptions,
} from "./wire/reader-types"

/**
 * SSEReader — reads an SSE endpoint using fetch + ReadableStream.
 *
 * Usage:
 *   const reader = new SSEReader('/api/agents/a1/events', { headers: {...} })
 *   const { snapshot, updates } = await reader.connect()
 *   // updates is ReadableStream<WireUpdateBatch>
 *   reader.close()  // when done
 */
export class SSEReader extends FrameReader {
  constructor(url: string, opts: SSEReaderOptions = {}) {
    super(createSseFramePipe(url, opts), opts)
  }
}
