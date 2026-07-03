/**
 * playable-segment.ts — ממשק PlayableSegment.
 *
 * כל segment מנהל את מחזור-החיים שלו (prepare → play → replay → dispose).
 * הפולימורפיזם: Mp3Segment (MediaSource/HTMLAudio) ו-PcmSegment (WebAudio).
 *
 * isComplete(): buffer שלם וניתן-לניגון-מחדש, ללא תלות במצב-הניגון הנוכחי.
 * play(): ניתן לקרוא שוב — replay ממחיק ומתחיל מ-0.
 */

export interface PlayableSegment {
  readonly segmentId: string
  /** מכין את הסגמנט מ-stream (אסינכרוני ברקע). */
  prepare(stream: ReadableStream<Uint8Array>, ac: AbortController): void
  /** מנגן מה-התחלה. ניתן לקרוא שוב (replay). */
  play(): Promise<void>
  /** משהה ניגון. */
  pause(): void
  /** ממשיך ניגון אחרי pause. */
  resume(): void
  /**
   * האם ה-buffer שלם וניתן לניגון-מחדש.
   * mp3: state ∈ {ready, playing, ended}
   * pcm: streamDone === true
   */
  isComplete(): boolean
  /** Teardown מלא — abort + free resources. */
  dispose(): void
}
