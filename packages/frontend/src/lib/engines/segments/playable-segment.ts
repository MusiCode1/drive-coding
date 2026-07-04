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
  /**
   * מנגן מה-התחלה. ניתן לקרוא שוב (replay).
   * Resolves on natural end **or** on stop() — never hangs.
   */
  play(): Promise<void>
  /** משהה ניגון. */
  pause(): void
  /** ממשיך ניגון אחרי pause. */
  resume(): void
  /**
   * עוצר את הניגון הפעיל **בלי למחוק את ה-buffer** (retain-and-replay).
   * בשימוש ע"י PlayableSink כשמתחילים segment אחר — מונע חפיפת-קול בניווט.
   * שונה מ-dispose() (שמוחק) ומ-pause() (ששומר מיקום ל-resume).
   * After stop(), the play() promise resolves (no deadlock).
   */
  stop(): void
  /**
   * האם ה-buffer שלם וניתן לניגון-מחדש.
   * mp3: state ∈ {ready, playing, ended}
   * pcm: streamDone === true
   */
  isComplete(): boolean
  /**
   * Enough data to start playback now (pcm: ≥1 buffer or done; mp3: complete).
   * Used by PlayableSink.isPlayable() for fast-start decision.
   */
  isPlayable(): boolean
  /** Teardown מלא — abort + free resources. */
  dispose(): void
}
