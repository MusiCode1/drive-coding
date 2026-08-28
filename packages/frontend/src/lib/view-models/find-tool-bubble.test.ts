import { describe, expect, it } from "vitest"
import type { Bubble, ToolBubble } from "$lib/types/bubble"
import { findToolBubble, mapToolBubble } from "./find-tool-bubble"

function makeTool(toolCallId: string, subFrames?: ToolBubble["subFrames"]): ToolBubble {
  return {
    id: `id-${toolCallId}`,
    kind: "tool",
    messageId: null,
    createdAt: 0,
    toolCall: {
      toolCallId,
      name: "tool",
      args: {},
      status: "pending",
    },
    segments: [],
    ...(subFrames !== undefined ? { subFrames } : {}),
  }
}

describe("findToolBubble", () => {
  it("finds a top-level tool bubble", () => {
    const parent = makeTool("toolu_PARENT")
    const bubbles: Bubble[] = [parent]
    expect(findToolBubble(bubbles, "toolu_PARENT")).toBe(parent)
  })

  it("finds a tool bubble nested one level deep", () => {
    const child = makeTool("toolu_CHILD")
    const parent = makeTool("toolu_PARENT", [child])
    const bubbles: Bubble[] = [parent]
    expect(findToolBubble(bubbles, "toolu_CHILD")).toBe(child)
  })

  it("finds a tool bubble nested two levels deep", () => {
    const grandchild = makeTool("toolu_GRANDCHILD")
    const child = makeTool("toolu_CHILD", [grandchild])
    const parent = makeTool("toolu_PARENT", [child])
    const bubbles: Bubble[] = [parent]
    expect(findToolBubble(bubbles, "toolu_GRANDCHILD")).toBe(grandchild)
  })

  it("returns undefined when toolCallId is missing", () => {
    const parent = makeTool("toolu_PARENT")
    expect(findToolBubble([parent], "toolu_MISSING")).toBeUndefined()
  })
})

describe("mapToolBubble", () => {
  it("maps a top-level tool bubble immutably", () => {
    const parent = makeTool("toolu_PARENT")
    const bubbles: Bubble[] = [parent]
    const next = mapToolBubble(bubbles, "toolu_PARENT", (b) => ({
      ...b,
      toolCall: { ...b.toolCall, status: "completed" },
    }))
    expect(next).not.toBe(bubbles)
    expect(next[0]?.kind === "tool" && next[0].toolCall.status).toBe("completed")
    expect(parent.toolCall.status).toBe("pending")
  })

  it("maps a nested tool bubble at depth 1", () => {
    const child = makeTool("toolu_CHILD")
    const parent = makeTool("toolu_PARENT", [child])
    const bubbles: Bubble[] = [parent]
    const next = mapToolBubble(bubbles, "toolu_CHILD", (b) => ({
      ...b,
      toolCall: { ...b.toolCall, status: "completed" },
    }))
    const mappedParent = next[0]
    expect(mappedParent?.kind === "tool" && mappedParent.subFrames?.[0]?.kind === "tool").toBe(true)
    if (mappedParent?.kind !== "tool") throw new Error("expected tool")
    const mappedChild = mappedParent.subFrames?.[0]
    expect(mappedChild?.kind === "tool" && mappedChild.toolCall.status).toBe("completed")
    expect(child.toolCall.status).toBe("pending")
  })

  it("maps a nested tool bubble at depth 2", () => {
    const grandchild = makeTool("toolu_GRANDCHILD")
    const child = makeTool("toolu_CHILD", [grandchild])
    const parent = makeTool("toolu_PARENT", [child])
    const bubbles: Bubble[] = [parent]
    const next = mapToolBubble(bubbles, "toolu_GRANDCHILD", (b) => ({
      ...b,
      toolCall: { ...b.toolCall, status: "completed", result: "done" },
    }))
    const found = findToolBubble(next, "toolu_GRANDCHILD")
    expect(found?.toolCall.status).toBe("completed")
    expect(found?.toolCall.result).toBe("done")
    expect(grandchild.toolCall.status).toBe("pending")
  })

  it("returns equivalent structure when toolCallId is missing", () => {
    const parent = makeTool("toolu_PARENT")
    const bubbles: Bubble[] = [parent]
    const fn = (b: ToolBubble) => ({ ...b, toolCall: { ...b.toolCall, status: "completed" as const } })
    const next = mapToolBubble(bubbles, "toolu_MISSING", fn)
    expect(next).toHaveLength(1)
    expect(next[0]?.kind === "tool" && next[0].toolCall.status).toBe("pending")
  })
})
