/**
 * tts-queue.test.ts — ‏OrderAllocator, ו-#49.
 */
import { describe, expect, it } from "vitest"
import { OrderAllocator } from "./tts-queue.js"

describe("OrderAllocator — clear() ובועות ישנות (#49)", () => {
  // 🔴 דווח מהשדה: "הודעה ישנה נדחפה לסוף, אחרי שלוש ההודעות החדשות".
  //
  // `next()` מקצה seq **חדש** לכל bubbleId שאינו במפה, וה-seq הגלובלי
  // מונוטוני. ⇒ אחרי `clear()`, בועה ישנה שמקבלת עוד מקטע מקבלת seq
  // **גבוה מכולם** ומתנגנת אחרונה.
  //
  // התיקון: `Speaker.#stopAndClear()` **אינו** קורא `clear()` עוד.
  // הטסט מקבע את ההתנהגות שגורמת לבאג, כדי שהיא תישאר מובנת ומכוונת.
  it("clear() מנתק bubbleId ותיק — המקטע הבא שלו מקבל seq גבוה", () => {
    const alloc = new OrderAllocator()
    const first = alloc.next("old")
    alloc.next("new-a")
    alloc.clear()
    const afterClear = alloc.next("old")
    expect(afterClear.seq).toBeGreaterThan(first.seq)
  })

  it("בלי clear() — bubbleId ותיק שומר על מקומו בסדר", () => {
    const alloc = new OrderAllocator()
    const first = alloc.next("old")
    alloc.next("new-a")
    alloc.next("new-b")
    const later = alloc.next("old")
    expect(later.seq).toBe(first.seq)
    expect(later.segmentIndex).toBeGreaterThan(first.segmentIndex)
  })
})
