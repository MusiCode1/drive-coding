import { describe, expect, it } from "vitest"
import type { Bubble, ToolBubble } from "$lib/types/bubble"
import { findToolBubble, mapToolBubble } from "./find-tool-bubble"

function makeTool(id: string, subFrames?: ToolBubble[]): ToolBubble {
  return {
    id: `bubble-${id}`,
    kind: "tool",
    messageId: null,
    createdAt: 0,
    segments: [],
    toolCall: {
      toolCallId: id,
      name: "tool",
      args: {},
      status: "pending",
    },
    ...(subFrames !== undefined && { subFrames }),
  }
}

describe("findToolBubble", () => {
  it("finds a top-level tool bubble", () => {
    const bubbles: Bubble[] = [makeTool("A"), makeTool("B")]
    expect(findToolBubble(bubbles, "B")?.toolCall.toolCallId).toBe("B")
  })

  it("finds a tool bubble nested one level deep", () => {
    const child = makeTool("CHILD")
    const parent = makeTool("PARENT", [child])
    const bubbles: Bubble[] = [parent]
    expect(findToolBubble(bubbles, "CHILD")?.toolCall.toolCallId).toBe("CHILD")
  })

  it("finds a tool bubble nested two levels deep", () => {
    const grandchild = makeTool("GRAND")
    const mid = makeTool("MID", [grandchild])
    const parent = makeTool("PARENT", [mid])
    const bubbles: Bubble[] = [parent]
    expect(findToolBubble(bubbles, "GRAND")?.toolCall.toolCallId).toBe("GRAND")
  })

  it("returns undefined when toolCallId is missing", () => {
    const bubbles: Bubble[] = [makeTool("A")]
    expect(findToolBubble(bubbles, "MISSING")).toBeUndefined()
  })
})

describe("mapToolBubble", () => {
  it("maps a top-level tool bubble immutably", () => {
    const bubbles: Bubble[] = [makeTool("A")]
    const next = mapToolBubble(bubbles, "A", (b) => ({
      ...b,
      toolCall: { ...b.toolCall, status: "completed" },
    }))
    expect(next).not.toBe(bubbles)
    expect(bubbles[0]?.kind === "tool" && bubbles[0].toolCall.status).toBe("pending")
    expect(next[0]?.kind === "tool" && next[0].toolCall.status).toBe("completed")
  })

  it("maps a nested tool bubble at depth 1", () => {
    const child = makeTool("CHILD")
    const parent = makeTool("PARENT", [child])
    const bubbles: Bubble[] = [parent]
    const next = mapToolBubble(bubbles, "CHILD", (b) => ({
      ...b,
      toolCall: { ...b.toolCall, status: "completed" },
    }))
    const nested = findToolBubble(next, "CHILD")
    expect(nested?.toolCall.status).toBe("completed")
    expect(findToolBubble(bubbles, "CHILD")?.toolCall.status).toBe("pending")
  })

  it("maps a nested tool bubble at depth 2", () => {
    const grandchild = makeTool("GRAND")
    const mid = makeTool("MID", [grandchild])
    const parent = makeTool("PARENT", [mid])
    const bubbles: Bubble[] = [parent]
    const next = mapToolBubble(bubbles, "GRAND", (b) => ({
      ...b,
      toolCall: { ...b.toolCall, status: "completed", result: "done" },
    }))
    expect(findToolBubble(next, "GRAND")?.toolCall.status).toBe("completed")
    expect(findToolBubble(next, "GRAND")?.toolCall.result).toBe("done")
  })

  it("returns same structure when toolCallId is not found", () => {
    const bubbles: Bubble[] = [makeTool("A")]
    const next = mapToolBubble(bubbles, "MISSING", (b) => ({
      ...b,
      toolCall: { ...b.toolCall, status: "completed" },
    }))
    expect(next).toBe(bubbles)
  })
})
