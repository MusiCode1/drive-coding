/**
 * bounded-collect.ts — bounded chunk accumulator for proxy cache writes.
 *
 * Slice: proxy-tap-memory (Commit 2)
 *
 * Used by the ElevenLabs cache path to replace tee+cacheStreamInBackground.
 * Limits the in-memory accumulation to capBytes. Above the cap, chunks are
 * discarded (truncated=true) and the final cache write is skipped.
 *
 * Zero audio retention guarantee: audio is buffered only up to capBytes.
 * Large responses (e.g. long TTS) exceed the cap → skipped from cache,
 * but streamed fully to the client (the TransformStream always enqueues).
 */

/** Maximum bytes to accumulate for a single cache entry. Default: 8MB. */
export const PROXY_CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024

export interface BoundedCollector {
  push(chunk: Uint8Array): void
  done(): { bytes: Uint8Array; truncated: boolean }
}

/**
 * Creates a BoundedCollector that accumulates up to capBytes.
 * Chunks beyond the cap are silently dropped (truncated=true).
 * The done() method merges and returns all accumulated bytes.
 *
 * Fail-safe: push() never throws — errors are absorbed silently.
 */
export function boundedCollector(capBytes = PROXY_CACHE_MAX_ENTRY_BYTES): BoundedCollector {
  const chunks: Uint8Array[] = []
  let accumulated = 0
  let truncated = false

  return {
    push(chunk: Uint8Array): void {
      try {
        if (truncated) return
        if (accumulated + chunk.length > capBytes) {
          truncated = true
          return
        }
        chunks.push(chunk)
        accumulated += chunk.length
      } catch {
        // fail-safe: never throw from push
        truncated = true
      }
    },
    done(): { bytes: Uint8Array; truncated: boolean } {
      const totalLength = chunks.reduce((s, c) => s + c.length, 0)
      const merged = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      return { bytes: merged, truncated }
    },
  }
}
