/**
 * audio-sink.ts — ממשק AudioSink + טיפוסים נלווים.
 *
 * AudioSink מוגדר כ-interface שגם AudioStream (MP3/MediaSource) וגם
 * PcmAudioStream (WebAudio) מממשים. Player מחזיק AudioSink בלבד —
 * אינו יודע על הפורמט.
 *
 * AudioSegmentState הועבר מ-audio-stream.ts לכאן (מקור-האמת).
 * audio-stream.ts ייבא אותו מכאן.
 *
 * SegmentOpts.format: אופציונלי, משמש רק את RoutingAudioSink (Commit 6)
 * לניתוב ל-sink הנכון. AudioStream ו-PcmAudioStream מתעלמים ממנו.
 */

export type AudioSegmentState = "loading" | "ready" | "playing" | "ended" | "cancelled"

export interface SegmentOpts {
  messageId?: string | null
  textHash?: string
  format?: "mp3" | "pcm"
}

export interface AudioSink {
  prepareSegment(
    segmentId: string,
    stream: ReadableStream<Uint8Array>,
    ac: AbortController,
    opts?: SegmentOpts,
  ): Promise<void>
  play(segmentId: string): Promise<void>
  cancel(segmentId: string): void
  clear(): void
  /** A3: משהה את הניגון הנוכחי. */
  pause(): void
  /** A3: ממשיך ניגון אחרי pause. */
  resume(): void
}
