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

  it("שתי בועות עם אותו (kind,messageId) מקבלות אותו מפתח (קלט לא-תקין; מתועד)", () => {
    const a = makeMessage("shared", "a")
    const b = makeMessage("shared", "b")
    expect(stableBubbleKey(a)).toBe(stableBubbleKey(b))
  })

  it("message עם messageId מבוסס על messageId (לא id)", () => {
    const bubble: Bubble = makeMessage("stable-id", "random-1")
    expect(stableBubbleKey(bubble)).toBe("message:m:stable-id")
  })
})
