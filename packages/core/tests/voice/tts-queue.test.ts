import { describe, it, expect } from "vitest"
import {
  compareOrderKey,
  OrderedQueue,
  OrderAllocator,
  type OrderKey,
} from "../../src/voice/tts-queue"

describe("compareOrderKey", () => {
  it("seq שונה → לפי seq", () => {
    expect(compareOrderKey({ seq: 1, segmentIndex: 0 }, { seq: 2, segmentIndex: 0 })).toBeLessThan(
      0,
    )
    expect(compareOrderKey({ seq: 2, segmentIndex: 0 }, { seq: 1, segmentIndex: 0 })).toBeGreaterThan(
      0,
    )
  })

  it("seq זהה → לפי segmentIndex", () => {
    expect(compareOrderKey({ seq: 1, segmentIndex: 0 }, { seq: 1, segmentIndex: 1 })).toBeLessThan(
      0,
    )
    expect(compareOrderKey({ seq: 1, segmentIndex: 1 }, { seq: 1, segmentIndex: 0 })).toBeGreaterThan(
      0,
    )
  })

  it("שווים → 0", () => {
    expect(compareOrderKey({ seq: 3, segmentIndex: 2 }, { seq: 3, segmentIndex: 2 })).toBe(0)
  })

  it("seq שלילי תמיד ראשון — signed comparison", () => {
    // guard ל-jumpToSegment שמשתמש ב-seq=-1
    expect(
      compareOrderKey({ seq: -1, segmentIndex: 0 }, { seq: 0, segmentIndex: 0 }),
    ).toBeLessThan(0)
  })
})

describe("OrderedQueue", () => {
  it("insert בסדר אקראי → takeNext מחזיר בסדר ממוין", () => {
    const q = new OrderedQueue<string>()
    q.insert({ seq: 2, segmentIndex: 0 }, "c")
    q.insert({ seq: 0, segmentIndex: 0 }, "a")
    q.insert({ seq: 1, segmentIndex: 0 }, "b")

    expect(q.takeNext()?.value).toBe("a")
    expect(q.takeNext()?.value).toBe("b")
    expect(q.takeNext()?.value).toBe("c")
  })

  it("regression: fetch מקבילי — (seq=2) לפני (seq=1) → (1,0) נשמע ראשון", () => {
    const q = new OrderedQueue<string>()
    q.insert({ seq: 2, segmentIndex: 0 }, "late")
    q.insert({ seq: 1, segmentIndex: 0 }, "early")

    expect(q.takeNext()?.value).toBe("early")
    expect(q.takeNext()?.value).toBe("late")
  })

  it("segmentIndex: (seq=1,idx=1) ואז (seq=1,idx=0) → (1,0) קודם", () => {
    const q = new OrderedQueue<string>()
    q.insert({ seq: 1, segmentIndex: 1 }, "second")
    q.insert({ seq: 1, segmentIndex: 0 }, "first")

    expect(q.takeNext()?.value).toBe("first")
    expect(q.takeNext()?.value).toBe("second")
  })

  it("takeNext על ריק → undefined", () => {
    const q = new OrderedQueue<string>()
    expect(q.takeNext()).toBeUndefined()
  })

  it("peekNext לא מסיר", () => {
    const q = new OrderedQueue<string>()
    q.insert({ seq: 0, segmentIndex: 0 }, "x")
    expect(q.peekNext()?.value).toBe("x")
    expect(q.size).toBe(1)
    expect(q.takeNext()?.value).toBe("x")
    expect(q.size).toBe(0)
  })

  it("size מדויק", () => {
    const q = new OrderedQueue<string>()
    expect(q.size).toBe(0)
    q.insert({ seq: 0, segmentIndex: 0 }, "a")
    expect(q.size).toBe(1)
    q.insert({ seq: 1, segmentIndex: 0 }, "b")
    expect(q.size).toBe(2)
    q.takeNext()
    expect(q.size).toBe(1)
  })

  it("clear מרוקן", () => {
    const q = new OrderedQueue<string>()
    q.insert({ seq: 0, segmentIndex: 0 }, "a")
    q.insert({ seq: 1, segmentIndex: 0 }, "b")
    q.clear()
    expect(q.size).toBe(0)
    expect(q.takeNext()).toBeUndefined()
  })
})

describe("OrderAllocator", () => {
  it("bubble חדש A → {seq:0, segmentIndex:0}", () => {
    const alloc = new OrderAllocator()
    expect(alloc.next("A")).toEqual({ seq: 0, segmentIndex: 0 })
  })

  it("קריאה שנייה לאותו bubble A → {seq:0, segmentIndex:1}", () => {
    const alloc = new OrderAllocator()
    alloc.next("A")
    expect(alloc.next("A")).toEqual({ seq: 0, segmentIndex: 1 })
  })

  it("A אז B → A=seq:0, B=seq:1 (seq מונוטוני)", () => {
    const alloc = new OrderAllocator()
    const a = alloc.next("A")
    const b = alloc.next("B")
    expect(a.seq).toBe(0)
    expect(b.seq).toBe(1)
    expect(b.segmentIndex).toBe(0)
  })

  it("interleaved: A, B, A → {0,0}, {1,0}, {0,1} — seq של A יציב", () => {
    const alloc = new OrderAllocator()
    expect(alloc.next("A")).toEqual({ seq: 0, segmentIndex: 0 })
    expect(alloc.next("B")).toEqual({ seq: 1, segmentIndex: 0 })
    expect(alloc.next("A")).toEqual({ seq: 0, segmentIndex: 1 })
  })

  it("clear → bubble A חדש מקבל seq חדש (לא 0), segmentIndex=0", () => {
    const alloc = new OrderAllocator()
    alloc.next("A") // seq 0
    alloc.next("B") // seq 1
    alloc.clear()
    // seq גלובלי לא מתאפס — A "חדש" אחרי clear מקבל seq=2
    const afterClear = alloc.next("A")
    expect(afterClear.seq).toBeGreaterThan(1) // לא חוזר ל-0
    expect(afterClear.segmentIndex).toBe(0) // segmentIndex מתאפס ל-bubble חדש
  })

  it("clear → seq גלובלי מונוטוני (לא מתאפס)", () => {
    const alloc = new OrderAllocator()
    alloc.next("X") // seq 0
    const before = alloc.next("Y") // seq 1
    alloc.clear()
    const after = alloc.next("Z") // seq צריך להיות > 1
    expect(after.seq).toBeGreaterThan(before.seq)
  })
})
