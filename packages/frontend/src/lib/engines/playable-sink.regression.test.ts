/**
 * playable-sink.regression.test.ts — ‏code review, 2026-08-21.
 *
 * ⚠️ כל טסט כאן מקבע ממצא שאומת **מול הקוד** לפני שתוקן — לא לפי דוח.
 */
import { describe, expect, it, vi } from "vitest"
import { PlayableSink } from "./playable-sink"
import type { PlayableSegment } from "./segments/types"

function fakeSegment(id: string, disposed: string[]): PlayableSegment {
  return {
    segmentId: id,
    prepare: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(() => disposed.push(id)),
    isComplete: () => true,
  } as unknown as PlayableSegment
}

const stream = () => new ReadableStream<Uint8Array>({ start: (c) => c.close() })

describe("PlayableSink — דריסה מפרקת", () => {
  // 🔴 `#segments.set()` דרס בלי `dispose()` — הישן נשאר חי בלי מפנה
  // (MediaSource / object-URL / צמתי-WebAudio). דליפה שגדלה עם כל refetch.
  it("הזמנה חוזרת של אותו id מפרקת את הקודם", async () => {
    const disposed: string[] = []
    let n = 0
    const sink = new PlayableSink(() => fakeSegment(`s-${n++}`, disposed))
    await sink.prepareSegment("same", stream(), new AbortController())
    await sink.prepareSegment("same", stream(), new AbortController())
    expect(disposed).toEqual(["s-0"])
  })
})

describe("PlayableSink — תצפית שאינה משקרת", () => {
  // 🔴 `#playedCount++` היה **לפני** ה-throw, ולכן ספר גם ניסיונות שנכשלו.
  it("ניסיון-ניגון שנכשל אינו נספר כהשמעה", async () => {
    const sink = new PlayableSink(() => fakeSegment("x", []))
    await expect(sink.play("no-such")).rejects.toThrow()
    expect(sink.debugInfo().played).toBe(0)
  })

  // 🔴 `cancel()` איפס `#current` ולא `#currentId` — הפאנל דיווח על segment
  // **מפורק** כ"מתנגן". תצפית שמשקרת גרועה מהיעדר תצפית.
  it("cancel מנקה גם את המזהה שהפאנל מציג", async () => {
    const sink = new PlayableSink(() => fakeSegment("a", []))
    await sink.prepareSegment("a", stream(), new AbortController())
    await sink.play("a")
    expect(sink.debugInfo().currentSegmentId).toBe("a")
    sink.cancel("a")
    expect(sink.debugInfo().currentSegmentId).toBeNull()
  })

  it("clear מנקה גם את המזהה", async () => {
    const sink = new PlayableSink(() => fakeSegment("b", []))
    await sink.prepareSegment("b", stream(), new AbortController())
    await sink.play("b")
    sink.clear()
    expect(sink.debugInfo().currentSegmentId).toBeNull()
    expect(sink.debugInfo().prepared).toBe(0)
  })
})
