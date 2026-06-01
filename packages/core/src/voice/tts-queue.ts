/**
 * tts-queue.ts — Pure ordering primitives for TTS playback.
 *
 * Three building blocks:
 *   - OrderKey: two-dimensional sort key (seq, segmentIndex).
 *   - compareOrderKey: lexicographic compare — <0 / 0 / >0.
 *   - OrderedQueue: sorted generic queue (insert keeps order, takeNext pops min).
 *   - OrderAllocator: allocates OrderKeys per bubble — pure, holds only counters.
 *
 * No IO, no browser globals — fully unit-testable.
 * Slice 22: introduced to fix parallel-fetch ordering and enable tool narration.
 */

/** מפתח סדר דו-מימדי. seq ראשי, segmentIndex משני. */
export type OrderKey = {
  /** מונה מונוטוני שמוקצה ע"י המפיק (Speaker) — סדר הבועות. */
  seq: number
  /** אינדקס המשפט בתוך הבועה (0-based). */
  segmentIndex: number
}

/** השוואה לקסיקוגרפית: seq, אז segmentIndex. <0 / 0 / >0. */
export function compareOrderKey(a: OrderKey, b: OrderKey): number {
  // חיסור רגיל (signed) — מכבד seq שלילי (used by jumpToSegment, seq=-1).
  const seqDiff = a.seq - b.seq
  if (seqDiff !== 0) return seqDiff
  return a.segmentIndex - b.segmentIndex
}

type Entry<T> = { key: OrderKey; value: T }

/**
 * תור ממוין גנרי לפי OrderKey. insert שומר על מיון.
 * takeNext מחזיר את הערך עם ה-OrderKey הקטן ביותר (ומסיר אותו), או undefined אם ריק.
 * peekNext מחזיר בלי להסיר.
 */
export class OrderedQueue<T> {
  #entries: Entry<T>[] = []

  get size(): number {
    return this.#entries.length
  }

  insert(key: OrderKey, value: T): void {
    // מצא את המיקום הנכון לשמור על מיון עולה (sorted insert).
    let i = this.#entries.length
    while (i > 0 && compareOrderKey(key, this.#entries[i - 1]!.key) < 0) {
      i--
    }
    this.#entries.splice(i, 0, { key, value })
  }

  takeNext(): { key: OrderKey; value: T } | undefined {
    return this.#entries.shift()
  }

  peekNext(): { key: OrderKey; value: T } | undefined {
    return this.#entries[0]
  }

  clear(): void {
    this.#entries = []
  }
}

/**
 * מקצה orderKey לבועות. pure — מחזיק רק את ה-state של ההקצאה (מונים), בלי IO.
 * ה-Speaker מחזיק instance אחד וקורא ל-next() לכל job. חולץ מ-Speaker כדי
 * שלוגיקת ההקצאה (seq יציב פר-bubble, segmentIndex עולה) תהיה ניתנת לבדיקת יחידה.
 */
export class OrderAllocator {
  /** מונה seq גלובלי — לא מתאפס ב-clear() כדי שיהיה מונוטוני בין שיחות. */
  #nextSeq = 0
  /** Map מ-bubbleId → {seq, nextSegmentIndex}. מנוקה ב-clear(). */
  #bubbles: Map<string, { seq: number; nextSegmentIndex: number }> = new Map()

  /**
   * מחזיר orderKey ל-job הבא של bubbleId נתון.
   * - bubbleId שלא נראה → seq חדש (מונוטוני), segmentIndex=0.
   * - bubbleId שכבר נראה → אותו seq, segmentIndex עולה ב-1 בכל קריאה.
   */
  next(bubbleId: string): OrderKey {
    let entry = this.#bubbles.get(bubbleId)
    if (entry === undefined) {
      entry = { seq: this.#nextSeq++, nextSegmentIndex: 0 }
      this.#bubbles.set(bubbleId, entry)
    }
    const key: OrderKey = { seq: entry.seq, segmentIndex: entry.nextSegmentIndex }
    entry.nextSegmentIndex++
    return key
  }

  /** מנקה את מצב הבועות. שים לב: ה-seq הגלובלי **לא** מתאפס (מונוטוניות בין שיחות). */
  clear(): void {
    this.#bubbles.clear()
  }
}
