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

describe("stableBubbleKey", () => {
  it("message ו-thought עם אותו messageId מקבלים מפתחות שונים (kind מפריד)", () => {
    const message = makeMessage("x")
    const thought = makeThought("x")
    expect(stableBubbleKey(message)).not.toBe(stableBubbleKey(thought))
  })

  it("tool מבוסס על toolCallId", () => {
    const tool = makeTool("call-1")
    expect(stableBubbleKey(tool)).toBe("tool:t:call-1")
  })

  it("user אופטימי (messageId=null) מבוסס על id", () => {
    const user = makeUser(null, "user-123")
    expect(stableBubbleKey(user)).toBe("user:i:user-123")
  })

  it("שתי בועות מופרדות עם אותו (kind,messageId) מקבלות מפתחות ייחודיים (מונע each_key_duplicate)", () => {
    const a = makeMessage("shared", "msg-a")
    const b = makeMessage("shared", "msg-b")
    expect(stableBubbleKey(a)).not.toBe(stableBubbleKey(b))
    expect(stableBubbleKey(a)).toBe("message:m:shared:msg-a")
    expect(stableBubbleKey(b)).toBe("message:m:shared:msg-b")
  })

  it("message עם messageId מבוסס על messageId ו-id", () => {
    const bubble: Bubble = makeMessage("stable-id", "random-1")
    expect(stableBubbleKey(bubble)).toBe("message:m:stable-id:random-1")
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
    const keys = bubbles.map(stableBubbleKey)
    const uniqueKeys = new Set(keys)
    expect(keys.length).toBe(bubbles.length)
    expect(uniqueKeys.size).toBe(bubbles.length)
  })
})
