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
import { applyPatch } from "./apply-patch"
import { recordCarried } from "./carried"
import type { SessionState } from "./types"
import { createInitialSessionState } from "./types"
import {
  SNAPSHOT_CHUNK_MAX_BYTES,
  snapshotFrame,
  snapshotFrames,
  snapshotPayload,
} from "./wire-frames"

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

function stateWithLongAssistantText(charCount: number): SessionState {
  let state = createInitialSessionState({ sessionId: "chunk-test" })
  state = applyPatch(state, {
    version: 1,
    op: "add-message",
    message: {
      id: "m_0",
      role: "assistant",
      messageId: "msg-0",
      segments: [{ id: "s_0", text: "x".repeat(charCount) }],
      timestamp: "2026-09-22T10:00:00.000Z",
    },
  })
  return state
}

function mergedUpdatesFromFrames(frames: ReturnType<typeof snapshotFrames>): unknown[] {
  const out: unknown[] = []
  for (const f of frames) {
    const payload = JSON.parse(f.data) as { updates: unknown[] }
    out.push(...payload.updates)
  }
  return out
}

describe("snapshotFrames", () => {
  it("‏state ריק ⇒ פריים אחד עם chunk.more === false", () => {
    const state = createInitialSessionState({ sessionId: null })
    const frames = snapshotFrames(state)
    expect(frames).toHaveLength(1)
    const payload = JSON.parse(frames[0]!.data) as { chunk?: { more: boolean } }
    expect(payload.chunk).toEqual({ i: 0, more: false })
  })

  it("‏state מתחת לתקציב ⇒ פריים אחד בלי שדה chunk", () => {
    const state = stateWithMessage()
    const frames = snapshotFrames(state, 9, { maxBytes: SNAPSHOT_CHUNK_MAX_BYTES })
    expect(frames).toHaveLength(1)
    const payload = JSON.parse(frames[0]!.data) as { chunk?: unknown }
    expect("chunk" in payload).toBe(false)
  })

  it("‏state מעל התקציב ⇒ ≥2 פריימים; איחוד updates ≡ snapshotPayload", () => {
    const state = stateWithLongAssistantText(80_000)
    const maxBytes = 4_000
    const frames = snapshotFrames(state, 5, { maxBytes })
    expect(frames.length).toBeGreaterThanOrEqual(2)
    expect(mergedUpdatesFromFrames(frames)).toEqual(snapshotPayload(state).updates)
    for (let i = 0; i < frames.length; i++) {
      const payload = JSON.parse(frames[i]!.data) as {
        chunk: { i: number; more: boolean }
        epoch?: number
      }
      expect(payload.chunk.i).toBe(i)
      expect(payload.chunk.more).toBe(i < frames.length - 1)
      if (i === 0) expect(payload.epoch).toBe(5)
      else expect("epoch" in payload).toBe(false)
    }
    expect(frames.every((f) => f.id === String(state.version))).toBe(true)
  })

  it("‏update בודד > maxBytes ⇒ נתח משלו, לא נחתך", () => {
    let state = createInitialSessionState({ sessionId: "big-one" })
    state = recordCarried(state, {
      sessionUpdate: "plan",
      entries: [{ content: "z".repeat(10_000), priority: "high", status: "pending" }],
    })
    const fullPlan = snapshotPayload(state).updates.find((u) => u.sessionUpdate === "plan")
    expect(fullPlan).toBeDefined()
    const frames = snapshotFrames(state, undefined, { maxBytes: 500 })
    expect(mergedUpdatesFromFrames(frames)).toEqual(snapshotPayload(state).updates)
    const planChunk = frames.find((f) => {
      const payload = JSON.parse(f.data) as { updates: unknown[] }
      return payload.updates.some((u) => (u as { sessionUpdate: string }).sessionUpdate === "plan")
    })
    expect(planChunk).toBeDefined()
    const planPayload = JSON.parse(planChunk!.data) as { updates: unknown[] }
    expect(planPayload.updates).toEqual([fullPlan])
  })
})
