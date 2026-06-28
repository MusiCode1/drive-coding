/**
 * routing-audio-sink.ts — מנתב פר-segment לפי format.
 *
 * Player רואה AudioSink אחד; constructor של Speaker לא משתנה.
 * ניתוב לפי opts.format: "pcm" → PcmAudioStream, כל שאר → AudioStream (mp3).
 * AudioStream ו-PcmAudioStream מתעלמים מ-opts.format (כל אחד יודע את שלו).
 *
 * cancel: מוחק את הרשומה מ-#byId אחרי ביטול (למנוע memory leak).
 * clear: מנקה את שני ה-sinks ואת ה-map.
 */

import type { AudioSink, SegmentOpts } from "./audio-sink"

export class RoutingAudioSink implements AudioSink {
  #byId = new Map<string, AudioSink>()

  constructor(
    private mp3: AudioSink,
    private pcm: AudioSink,
  ) {}

  async prepareSegment(
    id: string,
    stream: ReadableStream<Uint8Array>,
    ac: AbortController,
    opts?: SegmentOpts,
  ): Promise<void> {
    const sink = opts?.format === "pcm" ? this.pcm : this.mp3
    this.#byId.set(id, sink)
    return sink.prepareSegment(id, stream, ac, opts)
  }

  play(id: string): Promise<void> {
    return (this.#byId.get(id) ?? this.mp3).play(id)
  }

  cancel(id: string): void {
    const sink = this.#byId.get(id)
    if (sink) {
      sink.cancel(id)
      this.#byId.delete(id)
    }
  }

  /**
   * A3: מאציל pause לשני ה-sinks (מי שלא פעיל — no-op).
   * §9 Q2: שניהם (לא רק הפעיל) — הבחירה הפשוטה והבטוחה.
   */
  pause(): void {
    this.mp3.pause()
    this.pcm.pause()
  }

  /**
   * A3: מאציל resume לשני ה-sinks (מי שלא פעיל — no-op).
   */
  resume(): void {
    this.mp3.resume()
    this.pcm.resume()
  }

  clear(): void {
    this.mp3.clear()
    this.pcm.clear()
    this.#byId.clear()
  }
}
