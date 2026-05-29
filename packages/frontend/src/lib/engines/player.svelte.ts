/**
 * player.ts — נגן מקטעים סדרתי שרץ על גבי AudioStream.
 *
 * מחזיק תור FIFO של מזהי מקטעים (segment IDs) ומנגן אותם דרך `AudioStream.play`
 * בזה אחר זה. כאשר מקטע זורק שגיאה (בוטל / שגיאת רשת) אנחנו
 * מדלגים עליו וממשיכים לבא אחריו (התנהגות MIN-5).
 *
 * ה-state חשוף בתור `$state` של Svelte 5 כך שהתצוגות (views) יכולות להגיב ל-"האם משהו
 * מתנגן כרגע?" דרך `player.state === "playing"`.
 */

import type { AudioStream } from "./audio-stream"

export type PlayerState = "idle" | "playing"

export class Player {
  state: PlayerState = $state("idle")
  currentSegmentId: string | null = $state(null)

  #audioStream: AudioStream
  #queue: string[] = []
  #playing = false // שומר כניסה-מחדש (re-entrancy guard) עבור #playLoop

  constructor(audioStream: AudioStream) {
    this.#audioStream = audioStream
  }

  /**
   * מצרף מקטע לתור הניגון. אם ה-Player נמצא במצב המתנה (idle), הוא מתחיל את
   * לולאת הניגון. בטוח לקריאה מכל הקשר (context).
   */
  addSegment(segmentId: string): void {
    this.#queue.push(segmentId)
    if (this.#playing) return
    void this.#playLoop()
  }

  /**
   * שמור עבור slice 10 (ניגון מחדש של הקלטות) — לא בשימוש ב-slice 2.
   * מנקה את התור הנוכחי ומתחיל לנגן מ-`segmentId`.
   */
  jumpToSegment(segmentId: string): void {
    this.#queue = [segmentId]
    if (this.#playing) {
      // קריאת ה-play() הנוכחית תסתיים (resolve / reject) באופן טבעי; הלולאה
      // תאסוף אז את תוכן התור החדש.
      return
    }
    void this.#playLoop()
  }

  /**
   * עצירת הניגון: משהה את הנוכחי, מרוקן את התור, ומבטל כל מקטע שברשותנו.
   */
  stop(): void {
    const ids = [...this.#queue]
    if (this.currentSegmentId !== null) ids.push(this.currentSegmentId)
    this.#queue = []
    for (const id of ids) this.#audioStream.cancel(id)
    // ייתכן שהדפדפן לא יפעיל אירועי ended/error אחרי השהייה+ביטול; הצג מצב המתנה (idle) באופן מיידי.
    this.#playing = false
    this.state = "idle"
    this.currentSegmentId = null
  }

  async #playLoop(): Promise<void> {
    this.#playing = true
    this.state = "playing"
    try {
      while (this.#queue.length > 0) {
        const id = this.#queue.shift()
        if (id === undefined) break
        this.currentSegmentId = id
        try {
          await this.#audioStream.play(id)
        } catch (_e) {
          // ביקורת MIN-5: בוטל / שגיאה → מדלגים, וממשיכים לבא בתור.
        }
      }
    } finally {
      this.#playing = false
      this.state = "idle"
      this.currentSegmentId = null
    }
  }
}
