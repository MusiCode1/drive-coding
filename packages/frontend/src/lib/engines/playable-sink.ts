/**
 * playable-sink.ts — PlayableSink: sink מאוחד שמחזיק segments ב-memory.
 *
 * מחליף את RoutingAudioSink + AudioStream + PcmAudioStream.
 * כל segment נשמר בזיכרון אחרי ניגון — לא נמחק בניווט (retain-and-replay).
 * ניתוב פר-segment לפי opts.format: "pcm" → PcmSegment, אחרת → Mp3Segment.
 *
 * isComplete(id): מאציל ל-segment.isComplete() — משמש ל-skip-cancel ב-AudioPlaylist.
 * cancel(id): dispose של segment יחיד (skip-cancel / stop).
 * clear(): dispose על כל ה-segments (סוף חיי-פלייליסט).
 *
 * AudioContext משותף לכל PcmSegments (לא נוצר כאן — lazy ב-getCtx).
 */

import type { AudioSink, SegmentOpts } from "./audio-sink"
import { Mp3Segment } from "./segments/mp3-segment"
import { PcmSegment } from "./segments/pcm-segment"
import type { PlayableSegment } from "./segments/playable-segment"

export type SegmentFactory = (
  segmentId: string,
  stream: ReadableStream<Uint8Array>,
  ac: AbortController,
  opts?: import("./audio-sink").SegmentOpts,
) => PlayableSegment

export class PlayableSink implements AudioSink {
  #segments = new Map<string, PlayableSegment>()
  #ctx: AudioContext | null = null
  // nav-retain fix: ה-segment שמתנגן כרגע. play() של segment אחר עוצר אותו קודם —
  // בלי זה, ניווט (prev/next) מתחיל segment חדש בעוד הקודם עדיין משמיע → קקפוניה.
  #current: PlayableSegment | null = null
  readonly #segmentFactory?: SegmentFactory

  constructor(segmentFactory?: SegmentFactory) {
    this.#segmentFactory = segmentFactory
  }

  #getCtx(): AudioContext {
    if (!this.#ctx) {
      this.#ctx = new AudioContext({ sampleRate: 24000 })
    }
    return this.#ctx
  }

  async prepareSegment(
    segmentId: string,
    stream: ReadableStream<Uint8Array>,
    ac: AbortController,
    opts?: SegmentOpts,
  ): Promise<void> {
    let seg: PlayableSegment
    if (this.#segmentFactory !== undefined) {
      seg = this.#segmentFactory(segmentId, stream, ac, opts)
    } else if (opts?.format === "pcm") {
      const ctx = this.#getCtx()
      seg = new PcmSegment(segmentId, ctx)
    } else {
      seg = new Mp3Segment(segmentId)
    }
    this.#segments.set(segmentId, seg)
    seg.prepare(stream, ac)
    // prepareSegment מחזיר מיד (stream נצרך ברקע)
  }

  async play(segmentId: string): Promise<void> {
    const seg = this.#segments.get(segmentId)
    if (!seg) throw new Error(`PlayableSink: no segment ${segmentId}`)
    // nav-retain fix: עצור את ה-segment הקודם (שומר buffer ל-replay) לפני שמתחילים חדש.
    if (this.#current && this.#current !== seg) {
      this.#current.stop()
    }
    this.#current = seg
    return seg.play()
  }

  pause(): void {
    // משהה את כל ה-segments הפעילים
    for (const seg of this.#segments.values()) {
      seg.pause()
    }
  }

  resume(): void {
    this.#current?.resume()
  }

  /**
   * isComplete: האם ה-buffer של ה-segment שלם וניתן לניגון-מחדש.
   * משמש ל-skip-cancel ב-AudioPlaylist (#isComplete).
   */
  isComplete(segmentId: string): boolean {
    const seg = this.#segments.get(segmentId)
    if (!seg) return false
    return seg.isComplete()
  }

  /** Teardown של segment יחיד (skip-cancel / stop) — segment נשאר ב-#segments כ-disposed. */
  cancel(segmentId: string): void {
    const seg = this.#segments.get(segmentId)
    if (!seg) return
    if (this.#current === seg) this.#current = null
    seg.dispose()
    this.#segments.delete(segmentId)
  }

  /** Teardown של כל ה-segments (סוף חיי-פלייליסט). */
  clear(): void {
    for (const seg of this.#segments.values()) {
      seg.dispose()
    }
    this.#segments.clear()
    this.#current = null
  }
}
