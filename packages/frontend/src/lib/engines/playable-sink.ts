/**
 * playable-sink.ts — PlayableSink: sink מאוחד עם SharedAudioOutput יחיד.
 *
 * SharedAudioOutput הוא הבעלים של HTMLAudioElement (src-swap בין משפטים).
 * Mp3Segment / PcmSegment מקבלים אותו בבנאי — לא יוצרים Audio() משלהם.
 */

import { registerSink, type SinkDebugInfo } from "$lib/debug/playback-registry"
import type { AudioSink, SegmentOpts } from "./audio-sink.js"
import { Mp3Segment } from "./segments/mp3-segment.js"
import { PcmSegment } from "./segments/pcm-segment.js"
import type { PlayableSegment } from "./segments/playable-segment.js"
import { SharedAudioOutput } from "./shared-audio-output.js"

export type SegmentFactory = (
  segmentId: string,
  stream: ReadableStream<Uint8Array>,
  ac: AbortController,
  opts?: import("./audio-sink.js").SegmentOpts,
) => PlayableSegment

export class PlayableSink implements AudioSink {
  readonly #output = new SharedAudioOutput()
  #segments = new Map<string, PlayableSegment>()
  #currentFormat: "mp3" | "pcm" | null = null
  #current: PlayableSegment | null = null
  #currentId: string | null = null
  readonly #segmentFactory?: SegmentFactory
  #playedCount = 0

  constructor(segmentFactory?: SegmentFactory) {
    this.#segmentFactory = segmentFactory
    registerSink(this)
  }

  debugInfo(): SinkDebugInfo {
    return {
      prepared: this.#segments.size,
      played: this.#playedCount,
      currentSegmentId: this.#currentId,
    }
  }

  async prepareSegment(
    segmentId: string,
    stream: ReadableStream<Uint8Array>,
    ac: AbortController,
    opts?: SegmentOpts,
  ): Promise<void> {
    const format = opts?.format === "pcm" ? "pcm" : "mp3"
    this.#ensureFormat(format)

    let seg: PlayableSegment
    if (this.#segmentFactory !== undefined) {
      seg = this.#segmentFactory(segmentId, stream, ac, opts)
    } else if (format === "pcm") {
      seg = new PcmSegment(segmentId, this.#output)
    } else {
      seg = new Mp3Segment(segmentId, this.#output)
    }

    const prev = this.#segments.get(segmentId)
    if (prev !== undefined) {
      if (this.#current === prev) {
        this.#current = null
        this.#currentId = null
      }
      prev.dispose()
    }
    this.#segments.set(segmentId, seg)
    seg.prepare(stream, ac)
  }

  async play(segmentId: string): Promise<void> {
    const seg = this.#segments.get(segmentId)
    if (!seg) throw new Error(`PlayableSink: no segment ${segmentId}`)
    this.#playedCount += 1

    const prev = this.#current
    this.#current = seg
    this.#currentId = segmentId

    if (prev && prev !== seg) {
      prev.stop()
    }

    return seg.play()
  }

  pause(): void {
    this.#output.pause()
  }

  resume(): void {
    this.#output.resume()
  }

  isComplete(segmentId: string): boolean {
    const seg = this.#segments.get(segmentId)
    if (!seg) return false
    return seg.isComplete()
  }

  cancel(segmentId: string): void {
    const seg = this.#segments.get(segmentId)
    if (!seg) return
    if (this.#current === seg) {
      this.#current = null
      this.#currentId = null
    }
    seg.dispose()
    this.#segments.delete(segmentId)
  }

  clear(): void {
    for (const seg of this.#segments.values()) {
      seg.dispose()
    }
    this.#segments.clear()
    this.#output.reset()
    this.#current = null
    this.#currentId = null
    this.#currentFormat = null
  }

  #ensureFormat(format: "mp3" | "pcm"): void {
    if (this.#currentFormat === null) {
      this.#currentFormat = format
      this.#output.switchFormat("blob")
      return
    }
    if (this.#currentFormat !== format) {
      this.#output.switchFormat("blob")
      this.#currentFormat = format
    }
  }
}
