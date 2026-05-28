/**
 * audio-stream.ts — MediaSource-based audio queue.
 *
 * Each segment gets its own <audio> element + MediaSource pair.
 * Simple and robust: no single-SourceBuffer sequence-mode complexity.
 *
 * MED-6 (audit): 5s timeout on sourceopen to avoid infinite hang.
 * MIN-5 (brief): If stream is interrupted, state="cancelled", play() rejects →
 *   Player advances to next segment (skip).
 *
 * NOTE: MediaSource is not available in happy-dom (test environment).
 * Tests that exercise this class must either mock MediaSource or skip.
 */

export type AudioSegmentState = "loading" | "ready" | "playing" | "ended" | "cancelled"

export type AudioSegment = {
  segmentId: string
  audio: HTMLAudioElement
  mediaSource: MediaSource
  sourceBuffer: SourceBuffer | null
  abortController: AbortController
  state: AudioSegmentState
}

const SOURCEOPEN_TIMEOUT_MS = 5000

export class AudioStream {
  #segments = new Map<string, AudioSegment>()
  #current: AudioSegment | null = null

  /**
   * Prepare a segment from a fetch response stream.
   * Async; returns once MediaSource sourceopen fires (audio element is wired up).
   * Stream consumption continues in background.
   * MED-6: 5s timeout on sourceopen.
   */
  async prepareSegment(
    segmentId: string,
    stream: ReadableStream<Uint8Array>,
    ac: AbortController,
  ): Promise<void> {
    const audio = new Audio()
    const mediaSource = new MediaSource()
    audio.src = URL.createObjectURL(mediaSource)

    const seg: AudioSegment = {
      segmentId,
      audio,
      mediaSource,
      sourceBuffer: null,
      abortController: ac,
      state: "loading",
    }
    this.#segments.set(segmentId, seg)

    // MED-6: timeout on sourceopen (5s)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`sourceopen timeout for segment ${segmentId}`))
      }, SOURCEOPEN_TIMEOUT_MS)

      // Check if already open (race guard)
      if (mediaSource.readyState === "open") {
        clearTimeout(timer)
        seg.sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg")
        resolve()
        return
      }

      mediaSource.addEventListener(
        "sourceopen",
        () => {
          clearTimeout(timer)
          try {
            seg.sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg")
          } catch (e) {
            reject(e)
            return
          }
          resolve()
        },
        { once: true },
      )
    }).catch((e) => {
      seg.state = "cancelled"
      throw e
    })

    // Consume stream in background, appending to SourceBuffer
    ;(async () => {
      const reader = stream.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (seg.state === "cancelled") break
          if (seg.sourceBuffer && value) {
            await this.#appendBuffer(seg.sourceBuffer, value)
          }
        }
        if (seg.state !== "cancelled" && mediaSource.readyState === "open") {
          mediaSource.endOfStream()
          seg.state = "ready"
        }
      } catch (_e) {
        // MIN-5: stream interrupted — mark cancelled so play() rejects → skip
        if (seg.state !== "cancelled") {
          seg.state = "cancelled"
        }
      }
    })().catch(() => {})
  }

  /**
   * Play a segment. Waits if still loading (polls until ready or cancelled).
   * MIN-5: If segment is cancelled, rejects → Player skips to next.
   */
  async play(segmentId: string): Promise<void> {
    const seg = this.#segments.get(segmentId)
    if (!seg) throw new Error(`no segment ${segmentId}`)

    // Pause previous segment if switching
    if (this.#current && this.#current.segmentId !== segmentId) {
      this.#current.audio.pause()
    }
    this.#current = seg

    // Wait for segment to be ready or cancelled
    if (seg.state === "loading") {
      await this.#waitForReady(seg)
    }

    // MIN-5: cancelled → reject, Player skips
    if (seg.state === "cancelled") {
      throw new Error(`segment ${segmentId} was cancelled`)
    }

    seg.state = "playing"
    return new Promise((resolve, reject) => {
      seg.audio.addEventListener(
        "ended",
        () => {
          seg.state = "ended"
          resolve()
        },
        { once: true },
      )
      seg.audio.addEventListener("error", reject, { once: true })
      seg.audio.play().catch(reject)
    })
  }

  /** Cancel a segment — abort fetch, pause audio, clean up. */
  cancel(segmentId: string): void {
    const seg = this.#segments.get(segmentId)
    if (!seg) return
    seg.state = "cancelled"
    seg.abortController.abort()
    seg.audio.pause()
    try {
      URL.revokeObjectURL(seg.audio.src)
    } catch {
      // ignore
    }
    if (seg.mediaSource.readyState === "open") {
      try {
        seg.mediaSource.endOfStream()
      } catch {
        // ignore
      }
    }
    this.#segments.delete(segmentId)
    if (this.#current?.segmentId === segmentId) {
      this.#current = null
    }
  }

  /** Clear all segments. */
  clear(): void {
    for (const seg of this.#segments.values()) {
      this.cancel(seg.segmentId)
    }
    this.#current = null
  }

  /** Append a chunk to SourceBuffer, waiting for updateend. */
  #appendBuffer(sb: SourceBuffer, chunk: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const onEnd = () => {
        sb.removeEventListener("updateend", onEnd)
        resolve()
      }
      sb.addEventListener("updateend", onEnd)
      try {
        // Create a plain ArrayBuffer copy to avoid TypeScript's Uint8Array<ArrayBufferLike> mismatch
        const buf = new ArrayBuffer(chunk.byteLength)
        new Uint8Array(buf).set(chunk)
        sb.appendBuffer(buf)
      } catch (e) {
        sb.removeEventListener("updateend", onEnd)
        reject(e)
      }
    })
  }

  /** Poll until segment transitions from "loading" to any other state. */
  #waitForReady(seg: AudioSegment): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (seg.state !== "loading") {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
  }
}
