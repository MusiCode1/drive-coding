/**
 * activity-groups.test.ts — TDD ל-groupActivityRuns / isActivityBubble.
 */
import { describe, expect, it } from "vitest"
import type {
  Bubble,
  MessageBubble,
  ThoughtBubble,
  ToolBubble,
  UserBubble,
} from "$lib/types/bubble"
import { stableBubbleKey } from "$lib/util/bubble-key"
import { groupActivityRuns, isActivityBubble } from "./activity-groups"

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

describe("isActivityBubble", () => {
  it("returns true for thought and tool", () => {
    expect(isActivityBubble(makeThought("x"))).toBe(true)
    expect(isActivityBubble(makeTool("c1"))).toBe(true)
  })

  it("returns false for user and message", () => {
    expect(isActivityBubble(makeUser(null))).toBe(false)
    expect(isActivityBubble(makeMessage("x"))).toBe(false)
  })
})

describe("groupActivityRuns", () => {
  it("1: enabled=false — all single, same keys as stableBubbleKey", () => {
    const bubbles: Bubble[] = [
      makeUser(null, "u1"),
      makeThought("t1", "th1"),
      makeTool("call-1", "tool1"),
      makeMessage("m1", "msg1"),
    ]
    const items = groupActivityRuns(bubbles, false)
    expect(items).toHaveLength(4)
    for (let i = 0; i < bubbles.length; i++) {
      expect(items[i]).toEqual({
        kind: "single",
        key: stableBubbleKey(bubbles[i]!, bubbles),
        bubble: bubbles[i],
      })
    }
  })

  it("2: [user, thought, tool, tool, message] → [single, activity-group(3), single]", () => {
    const bubbles: Bubble[] = [
      makeUser(null, "u1"),
      makeThought("t1", "th1"),
      makeTool("call-1", "tool1"),
      makeTool("call-2", "tool2"),
      makeMessage("m1", "msg1"),
    ]
    const items = groupActivityRuns(bubbles, true)
    expect(items).toHaveLength(3)
    expect(items[0]?.kind).toBe("single")
    expect(items[1]?.kind).toBe("activity-group")
    if (items[1]?.kind === "activity-group") {
      expect(items[1].bubbles).toHaveLength(3)
    }
    expect(items[2]?.kind).toBe("single")
  })

  it("3: [user, tool, message, tool, message] → two separate groups", () => {
    const bubbles: Bubble[] = [
      makeUser(null, "u1"),
      makeTool("call-1", "tool1"),
      makeMessage("m1", "msg1"),
      makeTool("call-2", "tool2"),
      makeMessage("m2", "msg2"),
    ]
    const items = groupActivityRuns(bubbles, true)
    expect(items).toHaveLength(5)
    expect(items.map((it) => it.kind)).toEqual([
      "single",
      "activity-group",
      "single",
      "activity-group",
      "single",
    ])
    const groups = items.filter((it) => it.kind === "activity-group")
    expect(groups).toHaveLength(2)
  })

  it("4: run of length 1 is still activity-group", () => {
    const bubbles: Bubble[] = [makeUser(null, "u1"), makeTool("call-1", "tool1"), makeMessage("m1")]
    const items = groupActivityRuns(bubbles, true)
    expect(items[1]?.kind).toBe("activity-group")
    if (items[1]?.kind === "activity-group") {
      expect(items[1].bubbles).toHaveLength(1)
    }
  })

  it("5: empty list → []", () => {
    expect(groupActivityRuns([], true)).toEqual([])
    expect(groupActivityRuns([], false)).toEqual([])
  })

  it("6: group key stable when tool appended to run end", () => {
    const base: Bubble[] = [makeUser(null, "u1"), makeThought("t1", "th1"), makeTool("call-1")]
    const extended: Bubble[] = [...base, makeTool("call-2")]
    const keyBefore = groupActivityRuns(base, true)[1]?.key
    const keyAfter = groupActivityRuns(extended, true)[1]?.key
    expect(keyBefore).toBeDefined()
    expect(keyAfter).toBe(keyBefore)
  })

  it("7: message splitting run → two groups with different keys", () => {
    const before: Bubble[] = [
      makeThought("t1", "th1"),
      makeTool("call-1"),
      makeTool("call-2"),
    ]
    const after: Bubble[] = [
      makeThought("t1", "th1"),
      makeTool("call-1"),
      makeMessage("m1"),
      makeTool("call-2"),
    ]
    const itemsBefore = groupActivityRuns(before, true)
    const itemsAfter = groupActivityRuns(after, true)
    expect(itemsBefore).toHaveLength(1)
    expect(itemsAfter).toHaveLength(3)
    const groupKeysAfter = itemsAfter
      .filter((it) => it.kind === "activity-group")
      .map((it) => it.key)
    expect(groupKeysAfter).toHaveLength(2)
    expect(groupKeysAfter[1]).not.toBe(itemsBefore[0]?.key)
  })

  it("8: all noise → single activity-group", () => {
    const bubbles: Bubble[] = [
      makeThought("t1", "th1"),
      makeTool("call-1"),
      makeTool("call-2"),
    ]
    const items = groupActivityRuns(bubbles, true)
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe("activity-group")
    if (items[0]?.kind === "activity-group") {
      expect(items[0].bubbles).toHaveLength(3)
    }
  })
})
