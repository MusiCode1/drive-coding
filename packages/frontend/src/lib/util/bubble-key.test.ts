/**
 * bubble-key.test.ts — TDD ל-stableBubbleKey.
 *
 * slice reconnect-bubble-merge, Commit 0: RED phase — כל הטסטים נכתבים לפני הקוד.
 */
import { describe, expect, it } from "vitest"
import type {
  Bubble,
  MessageBubble,
  ThoughtBubble,
  ToolBubble,
  UserBubble,
} from "$lib/types/bubble"
import { stableBubbleKey } from "./bubble-key"

function makeMessage(messageId: string | null, id = "auto-msg"): MessageBubble {
  return { id, messageId, createdAt: 0, kind: "message", segments: [] }
}

function makeThought(messageId: string | null, id = "auto-thought"): ThoughtBubble {
  return { id, messageId, createdAt: 0, kind: "thought", segments: [] }
}

function makeUser(messageId: string | null, id = "auto-user"): UserBubble {
  return { id, messageId, createdAt: 0, kind: "user", segments: [] }
}

function makeTool(toolCallId: string, id = "auto-tool"): ToolBubble {
  return {
    id,
    messageId: null,
    createdAt: 0,
    kind: "tool",
    segments: [],
    toolCall: { toolCallId, name: "read", args: undefined, status: "completed" },
  }
}

function keysOf(list: readonly Bubble[]): string[] {
  return list.map((b) => stableBubbleKey(b, list))
}

describe("stableBubbleKey", () => {
  it("message ו-thought עם אותו messageId מקבלים מפתחות שונים (kind מפריד)", () => {
    const message = makeMessage("x")
    const thought = makeThought("x")
    const list = [message, thought]
    expect(stableBubbleKey(message, list)).not.toBe(stableBubbleKey(thought, list))
  })

  it("tool מבוסס על toolCallId", () => {
    const tool = makeTool("call-1")
    expect(stableBubbleKey(tool, [tool])).toBe("tool:t:call-1")
  })

  it("user אופטימי (messageId=null) מבוסס על id", () => {
    const user = makeUser(null, "user-123")
    expect(stableBubbleKey(user, [user])).toBe("user:i:user-123")
  })

  it("מופע ראשון של (kind,messageId) בלי סיומת n", () => {
    const bubble: Bubble = makeMessage("stable-id", "random-1")
    expect(stableBubbleKey(bubble, [bubble])).toBe("message:m:stable-id")
  })

  it("שתי בועות מופרדות עם אותו (kind,messageId) מקבלות :n2 על המופע השני", () => {
    const a = makeMessage("shared", "msg-a")
    const b = makeMessage("shared", "msg-b")
    const list = [a, b]
    expect(stableBubbleKey(a, list)).toBe("message:m:shared")
    expect(stableBubbleKey(b, list)).toBe("message:m:shared:n2")
  })

  it("מופע שלישי מקבל :n3", () => {
    const list = [makeMessage("x", "a"), makeMessage("x", "b"), makeMessage("x", "c")]
    expect(keysOf(list)).toEqual(["message:m:x", "message:m:x:n2", "message:m:x:n3"])
  })

  it("n דטרמיניסטי לפי סדר — ids מתחדשים לא משנים מפתחות (reconnect-stable)", () => {
    const tool = makeTool("call-1", "t-live")
    const live: Bubble[] = [makeMessage("x", "id-a"), tool, makeMessage("x", "id-b")]
    const replay: Bubble[] = [
      makeMessage("x", "other-a"),
      makeTool("call-1", "t-replay"),
      makeMessage("x", "other-b"),
    ]
    expect(keysOf(live)).toEqual(keysOf(replay))
    expect(keysOf(live)).toEqual(["message:m:x", "tool:t:call-1", "message:m:x:n2"])
  })

  it("מערך בועות עם כפילויות messageId אינו מייצר אף מפתח כפול (dupes.length === 0)", () => {
    const bubbles: Bubble[] = [
      makeUser("msg-1", "u1"),
      makeMessage("msg-1", "m1"),
      makeTool("call-1", "t1"),
      makeMessage("msg-1", "m2"),
      makeThought("msg-1", "th1"),
      makeMessage("msg-1", "m3"),
    ]
    const keys = keysOf(bubbles)
    const uniqueKeys = new Set(keys)
    expect(keys.length).toBe(bubbles.length)
    expect(uniqueKeys.size).toBe(bubbles.length)
    expect(keys).toEqual([
      "user:m:msg-1",
      "message:m:msg-1",
      "tool:t:call-1",
      "message:m:msg-1:n2",
      "thought:m:msg-1",
      "message:m:msg-1:n3",
    ])
  })
})
