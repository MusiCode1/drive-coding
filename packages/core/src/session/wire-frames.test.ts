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
import { HISTORY_PAGE_BYTES_MAX } from "./history-range"
import type { Patch, SessionState } from "./types"
import { createInitialSessionState } from "./types"
import { snapshotFrame, snapshotPayload, updateFrame } from "./wire-frames"

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

  it("mode meta omits messages and carried", () => {
    const state = recordCarried(stateWithMessage(), {
      sessionUpdate: "plan",
      entries: [{ content: "צעד", priority: "high", status: "pending" }],
    })
    const payload = JSON.parse(snapshotFrame(state, 3, "meta").data) as ReturnType<
      typeof snapshotPayload
    >
    expect(payload.historyOmitted).toEqual({ messageCount: 1 })
    expect(payload.updates.some((u) => u.sessionUpdate === "plan")).toBe(false)
    expect(payload.updates.some((u) => String(u.sessionUpdate).endsWith("_message"))).toBe(false)
    expect(payload.updates.some((u) => u.sessionUpdate === "session_info_update")).toBe(true)
  })
})

describe("snapshotPayload pages", () => {
  it("tail page includes page metadata", () => {
    const state = stateWithMessage()
    const payload = snapshotPayload(state, undefined, {
      range: { tail: true, maxBytes: HISTORY_PAGE_BYTES_MAX },
    })
    expect(payload.page?.lastSeq).toBe(0)
  })

  it("tail puts carried before the page when anchor is outside the slice", () => {
    const state: SessionState = {
      ...createInitialSessionState({ sessionId: "sess-1" }),
      version: 3,
      messages: [
        {
          id: "m_0",
          role: "user",
          messageId: "u0",
          segments: [{ id: "s_0", text: "x".repeat(400_000) }],
        },
        {
          id: "m_1",
          role: "assistant",
          messageId: "a1",
          segments: [{ id: "s_1", text: "two" }],
        },
        {
          id: "m_2",
          role: "user",
          messageId: "u2",
          segments: [{ id: "s_2", text: "three" }],
        },
      ],
      nextMessageSeq: 3,
      carried: [
        {
          key: "plan",
          after: "m_0",
          update: {
            sessionUpdate: "plan",
            entries: [{ content: "x", priority: "high", status: "pending" }],
          },
        },
      ],
    }
    const payload = snapshotPayload(state, undefined, {
      range: { tail: true, maxBytes: 4096 },
    })
    const kinds = payload.updates.map((u) => u.sessionUpdate)
    expect(kinds.indexOf("plan")).toBeLessThan(kinds.indexOf("user_message"))
  })

  it("before page is messages only", () => {
    const state: SessionState = {
      ...recordCarried(stateWithMessage(), {
        sessionUpdate: "plan",
        entries: [{ content: "צעד", priority: "high", status: "pending" }],
      }),
      messages: [
        {
          id: "m_0",
          role: "user",
          messageId: "u0",
          segments: [{ id: "s_0", text: "one" }],
        },
        {
          id: "m_1",
          role: "assistant",
          messageId: "a1",
          segments: [{ id: "s_1", text: "two" }],
        },
      ],
      nextMessageSeq: 2,
    }
    const payload = snapshotPayload(state, undefined, {
      range: { before: 1, maxBytes: HISTORY_PAGE_BYTES_MAX },
    })
    const kinds = payload.updates.map((u) => u.sessionUpdate)
    expect(kinds).toEqual(["user_message"])
  })
})

describe("updateFrame meta reset", () => {
  it("prepends _drive/reset and omits message history", () => {
    const state = stateWithMessage()
    const patch: Patch = {
      version: 4,
      op: "reset",
      messages: [],
      nextMessageSeq: 0,
      nextSegmentSeq: 0,
    }
    const frame = updateFrame(state, patch, "meta")
    expect(frame).not.toBeNull()
    const batch = JSON.parse(frame!.data) as { params: { update: { sessionUpdate: string } } }[]
    expect(batch.map((n) => n.params.update.sessionUpdate)).toContain("_drive/reset")
    expect(batch.some((n) => String(n.params.update.sessionUpdate).endsWith("_message"))).toBe(
      false,
    )
  })
})
