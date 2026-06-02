/**
 * player.ts — נגן מקטעים ממוין לפי OrderKey שרץ על גבי AudioStream.
 *
 * slice 22: מחליף תור FIFO פשוט ב-OrderedQueue ממוין לפי (seq, segmentIndex).
 * המשמעות: גם אם fetch של משפט מאוחר חוזר לפני משפט מוקדם (קבלנות מקבילית),
 * ה-Player ינגן בסדר הכרונולוגי הנכון.
 *
 * best-effort skip (MIN-5): AudioStream.play ממתין אם state="loading" ודוחה אם
 * "cancelled" — כך שמשפט שנכשל מדולג ומשפט הבא נשמע. אין timeout נוסף ב-Player.
 */

import { OrderedQueue, type OrderKey } from "@drive-coding/core/voice/tts-queue"
import type { AudioStream } from "./audio-stream"

export type PlayerState = "idle" | "playing"

export class Player {
  state: PlayerState = $state("idle")
  currentSegmentId: string | null = $state(null)

  #audioStream: AudioStream
  #queue = new OrderedQueue<string>()  // slice 22: היה string[]
  #playing = false // שומר כניסה-מחדש (re-entrancy guard) עבור #playLoop
  // slice 6: callback גנרי (לא יודע על cues — Speaker מספק)
  #onPlaybackStart?: () => void

  constructor(audioStream: AudioStream, onPlaybackStart?: () => void) {
    this.#audioStream = audioStream
    this.#onPlaybackStart = onPlaybackStart
  }

  /**
   * מצרף מקטע לתור הממוין. אם ה-Player נמצא במצב המתנה (idle), הוא מתחיל את
   * לולאת הניגון. בטוח לקריאה מכל הקשר (context).
   * slice 22: מקבל orderKey לסדר נכון תחת fetch מקבילי.
   */
  addSegment(segmentId: string, orderKey: OrderKey): void {
    this.#queue.insert(orderKey, segmentId)
    if (this.#playing) return
    void this.#playLoop()
  }

  /**
   * שמור עבור slice 10 (ניגון מחדש של הקלטות) — לא בשימוש ב-slice 2.
   * מנקה את התור הנוכחי ומתחיל לנגן מ-`segmentId`.
   * slice 22: משתמש ב-orderKey של {seq:-1, segmentIndex:0} — תמיד ראשון.
   */
  jumpToSegment(segmentId: string): void {
    this.#queue.clear()
    this.#queue.insert({ seq: -1, segmentIndex: 0 }, segmentId)
    if (this.#playing) return
    void this.#playLoop()
  }

  /**
   * עצירת הניגון: משהה את הנוכחי, מרוקן את התור, ומבטל כל מקטע שברשותנו.
   */
  stop(): void {
    const ids: string[] = []
    let n = this.#queue.takeNext()
    while (n !== undefined) { ids.push(n.value); n = this.#queue.takeNext() }
    if (this.currentSegmentId !== null) ids.push(this.currentSegmentId)
    this.#queue.clear()
    for (const id of ids) this.#audioStream.cancel(id)
    // ייתכן שהדפדפן לא יפעיל אירועי ended/error אחרי השהייה+ביטול; הצג מצב המתנה (idle) באופן מיידי.
    this.#playing = false
    this.state = "idle"
    this.currentSegmentId = null
  }

  async #playLoop(): Promise<void> {
    this.#playing = true
    this.state = "playing"
    // slice 6: callback גנרי — מופעל פעם אחת כשה-Player עובר idle→playing.
    // Speaker מספק callback שמנגן cue "speaking" + guard #spokeThisTurn.
    this.#onPlaybackStart?.()
    try {
      let next = this.#queue.takeNext()
      while (next !== undefined) {
        const id = next.value
        this.currentSegmentId = id
        try {
          await this.#audioStream.play(id)
        } catch (_e) {
          // MIN-5: בוטל / שגיאה / לא-מוכן → דלג, המשך לבא בתור (best-effort).
        }
        next = this.#queue.takeNext()
      }
    } finally {
      this.#playing = false
      this.state = "idle"
      this.currentSegmentId = null
    }
  }
}
