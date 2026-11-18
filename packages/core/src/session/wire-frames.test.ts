/**
 * wire-frames.test.ts — `snapshotPayload` והיחס שלה ל-`snapshotFrame`.
 *
 * Testing: tdd (בריף `history-get` §4 C0)
 *
 * ⚠️ **מה הטסטים כאן אוכפים ומה לא.** ‏`snapshotPayload` נועדה להיות המקור
 * היחיד של מטען ה-snapshot, כדי ש-frame-zero ו-`GET …/history` לא ייפרדו
 * בשקט. אבל "העתק" של הבנייה עדיין קורא ל-`stateToSessionUpdates`, ולכן שני
 * האגפים של ההשוואה יוצאים זהים בין אם יש מקור אחד ובין אם שניים ⇒ **שום
 * טסט כאן אינו תופס את ההעתק ברגע שנוצר.** מה שהוא כן תופס הוא ה**סטייה**:
 * שדה שיתווסף למטען ולא יגיע ל-frame (או להפך) מאדים מיד. כלל מקור-אחד
 * עצמו נאכף ב-review.
 */

import { describe, expect, it } from "vitest"
import { recordCarried } from "./carried"
import type { SessionState } from "./types"
import { createInitialSessionState } from "./types"
import { snapshotFrame, snapshotPayload } from "./wire-frames"

function stateWithMessage(): SessionState {
  const base = createInitialSessionState({ sessionId: "sess-1" })
  return {
    ...base,
    version: 3,
    title: "עם הודעה",
    messages: [
      {
        id: "m_0",
        role: "assistant",
        messageId: "msg-a",
        segments: [{ id: "s_0", text: "שלום" }],
        timestamp: "2026-09-22T10:00:00.000Z",
      },
    ],
    nextMessageSeq: 1,
    nextSegmentSeq: 1,
  }
}

describe("snapshotPayload", () => {
  it("‏frame-zero הוא בדיוק המטען + מסגור — `JSON.parse(data)` שווה ל-payload", () => {
    const state = stateWithMessage()
    expect(JSON.parse(snapshotFrame(state, 3).data)).toEqual(snapshotPayload(state, 3))
  })

  it("‏בלי epoch — השדה **נעדר**, לא `undefined`", () => {
    const payload = snapshotPayload(stateWithMessage())
    expect("epoch" in payload).toBe(false)
  })

  it("‏עם epoch — השדה נוכח עם הערך שנמסר", () => {
    expect(snapshotPayload(stateWithMessage(), 7).epoch).toBe(7)
  })

  it("‏המטען נושא sessionId · version · updates", () => {
    const payload = snapshotPayload(stateWithMessage())
    expect(payload.sessionId).toBe("sess-1")
    expect(payload.version).toBe(3)
    expect(Array.isArray(payload.updates)).toBe(true)
  })

  it("‏`carried` נשזר ל-updates גם דרך המטען", () => {
    const state = recordCarried(stateWithMessage(), {
      sessionUpdate: "plan",
      entries: [{ content: "צעד", priority: "high", status: "pending" }],
    })
    const kinds = snapshotPayload(state).updates.map((u) => u.sessionUpdate)
    expect(kinds).toContain("plan")
  })
})

describe("snapshotFrame — המסגור לא השתנה", () => {
  it("‏`event` הוא snapshot ו-`id` הוא ה-version", () => {
    const state = stateWithMessage()
    const frame = snapshotFrame(state, 3)
    expect(frame.event).toBe("snapshot")
    expect(frame.id).toBe(String(state.version))
  })
})
