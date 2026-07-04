import type { FetchState } from "@drive-coding/core/voice/playlist-decision"

/**
 * A producer owns the TTS fetch lifecycle for the segments it reserved.
 * The playlist asks it "what's the fetch state?" and tells it "(re)fetch / cancel".
 * Idempotent by contract: ensureFetch on a live/ready fetch is a no-op;
 * cancelFetch guarantees no later markReady/markError for that segment.
 */
export interface SegmentProducer {
  /** Start (or restart) synthesis for a segment that is not buffered and not in-flight. Idempotent. */
  ensureFetch(segmentId: string): void
  /** Abort any live fetch; guarantee no subsequent markReady/markError for this segment. */
  cancelFetch(segmentId: string): void
  /** Current production status: in-flight (pending/fetching) | failed (error) | idle (none/done). */
  fetchState(segmentId: string): FetchState
}
