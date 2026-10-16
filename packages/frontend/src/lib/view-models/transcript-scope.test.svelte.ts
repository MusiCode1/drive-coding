/** @vitest-environment jsdom */
import { flushSync } from "svelte"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ToolBubble, UserBubble } from "$lib/types/bubble"
import {
  appendAgentPlaceholder,
  appendUserImage,
  appendUserPlaceholder,
} from "./agent-session-bubble-append"
import type { ClaudeSubagentEvent } from "./claude-subagent-parse"
import {
  handleSubagentToolCall,
  handleSubagentToolCallUpdate,
  type SubagentToolNestingDeps,
} from "./subagent-tool-nesting"
import { TranscriptScope } from "./transcript-scope.svelte"

const user = (id = "u", messageId: string | null = null): UserBubble => ({
  id,
  kind: "user",
  messageId,
  createdAt: 1,
  segments: [{ id: "s", text: id }],
  recordingId: "recording",
})
const tool = (id = "parent"): ToolBubble => ({
  id,
  kind: "tool",
  messageId: null,
  createdAt: 1,
  segments: [],
  toolCall: { toolCallId: id, name: "Task", args: {}, status: "pending" },
})
const delta = (id: string, parentToolUseId = "parent"): ClaudeSubagentEvent => ({
  kind: "assistantDelta",
  parentToolUseId,
  messageId: id,
  blocks: [{ type: "text", text: id }],
})
afterEach(() => vi.restoreAllMocks())

describe("TranscriptScope reactive owner", () => {
  it("observes append/grouping, replace, patch/reset and snapshot release through a Svelte effect", () => {
    const scope = new TranscriptScope()
    const seen: string[] = []
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(
          JSON.stringify({
            live: scope.bubbles,
            display: scope.renderBubbles,
            replay: scope.isReconnectReplay,
          }),
        )
      })
    })
    try {
      flushSync()
      scope.append(user())
      flushSync()
      const live = scope.bubbles
      const original = live[0]
      scope.freezeDisplay()
      appendUserImage(scope, null, { mimeType: "image/png", data: "frozen-image" })
      appendUserPlaceholder(scope, null, { kind: "audio" })
      flushSync()
      expect(scope.bubbles).toBe(live)
      expect(scope.renderBubbles).toBe(live)
      expect(scope.bubbles[0]).toBe(original)
      expect(seen.at(-1)).toContain("frozen-image")
      scope.replace([user("replacement")])
      flushSync()
      expect(scope.bubbles).not.toBe(live)
      expect(scope.renderBubbles).toBe(live)
      const replacement = scope.bubbles
      appendUserPlaceholder(scope, null, { kind: "resource" })
      flushSync()
      expect(scope.bubbles).toBe(replacement)
      expect(scope.renderBubbles[0]).toBe(original)
      expect(JSON.stringify(scope.renderBubbles)).not.toContain("replacement")
      scope.applyPatches([
        {
          version: 1,
          op: "add-message",
          message: {
            id: "before-reset",
            role: "assistant",
            messageId: "before-reset",
            segments: [],
          },
        },
        {
          version: 2,
          op: "reset",
          nextMessageSeq: 0,
          nextSegmentSeq: 0,
          messages: [
            {
              id: "reset",
              role: "assistant",
              messageId: "reset",
              segments: [{ id: "r", text: "reset-value" }],
            },
          ],
        },
        {
          version: 3,
          op: "append-segment",
          targetId: "reset",
          segment: { id: "after", text: "after-reset" },
        },
      ])
      flushSync()
      expect(scope.bubbles).toBe(replacement)
      expect(scope.bubbles.map((b) => b.id)).toEqual(["reset"])
      expect(scope.bubbles[0]?.segments.map((s) => s.text)).toEqual(["reset-value", "after-reset"])
      expect(scope.renderBubbles).toBe(live)
      scope.releaseDisplay()
      flushSync()
      expect(scope.renderBubbles).toBe(replacement)
      expect(seen.at(-1)).toContain("after-reset")
      expect(seen.at(-1)).toContain('"replay":false')
      expect(seen.length).toBeGreaterThanOrEqual(7)
    } finally {
      stop()
    }
  })

  it("reset mutates the frozen array itself; append never replaces its bubble", () => {
    const scope = new TranscriptScope()
    scope.append(user())
    scope.freezeDisplay()
    const original = scope.bubbles
    scope.applyPatches([
      { version: 2, op: "reset", nextMessageSeq: 0, nextSegmentSeq: 0, messages: [] },
    ])
    expect(scope.renderBubbles).toBe(original)
    expect(original).toHaveLength(0)
    appendAgentPlaceholder(scope, "message", { kind: "image" })
    const message = scope.bubbles[0]
    appendAgentPlaceholder(scope, "message", { kind: "audio" })
    expect(scope.bubbles).toBe(original)
    expect(scope.renderBubbles[0]).toBe(message)
    expect(message?.kind === "message" && message.contentPlaceholders?.map((p) => p.kind)).toEqual([
      "image",
      "audio",
    ])
  })

  it("adoption stops at the matching ID before an older null bubble", () => {
    const scope = new TranscriptScope()
    scope.replace([user("older"), user("matching", "same"), user("other", "other")])
    scope.adoptUserMessageId("same")
    expect(scope.bubbles.map((b) => b.messageId)).toEqual([null, "same", "other"])
    scope.adoptUserMessageId("new")
    expect(scope.bubbles.map((b) => b.messageId)).toEqual(["new", "same", "other"])
    scope.adoptUserMessageId(null)
    expect(scope.bubbles[0]?.messageId).toBe("new")
  })

  it("allocates clock and UUID only for newly created append bubbles", () => {
    const scope = new TranscriptScope()
    const clock = vi.spyOn(Date, "now").mockReturnValue(123)
    const uuid = vi.spyOn(crypto, "randomUUID")
    appendUserImage(scope, "image", { mimeType: "image/png", data: "one" })
    appendUserImage(scope, "image", { mimeType: "image/png", data: "two" })
    appendUserPlaceholder(scope, "image", { kind: "audio" })
    expect(clock).toHaveBeenCalledTimes(1)
    expect(uuid).toHaveBeenCalledTimes(1)
    expect(scope.bubbles[0]?.createdAt).toBe(123)
    appendAgentPlaceholder(scope, "image", { kind: "image" })
    appendAgentPlaceholder(scope, "image", { kind: "audio" })
    expect(clock).toHaveBeenCalledTimes(2)
    expect(uuid).toHaveBeenCalledTimes(2)
  })
})

describe("subagent projection lifetime", () => {
  it("queues 50, drops oldest, samples per event only after Task lookup", () => {
    const scope = new TranscriptScope()
    const clock = vi.spyOn(Date, "now")
    for (let i = 0; i < 51; i++) scope.onSubagentEvent(delta(`message-${i}`))
    expect(clock).not.toHaveBeenCalled()
    scope.append(tool())
    let time = 100
    clock.mockImplementation(() => ++time)
    scope.flushPendingSubagentEvents("parent")
    const parent = scope.bubbles[0] as ToolBubble
    expect(parent.subFrames).toHaveLength(50)
    expect(parent.subFrames?.map((b) => b.createdAt)).toEqual(
      Array.from({ length: 50 }, (_, i) => 101 + i),
    )
    expect(JSON.stringify(parent.subFrames)).not.toContain('"message-0"')
    expect(JSON.stringify(parent.subFrames)).toContain("message-50")
    expect(clock).toHaveBeenCalledTimes(50)
    scope.flushPendingSubagentEvents("parent")
    expect(clock).toHaveBeenCalledTimes(50)
  })

  it("flush removes matching events even without parent; replace/reset keep index and pending until cleanup", () => {
    const scope = new TranscriptScope()
    scope.onSubagentEvent(delta("discard"))
    scope.flushPendingSubagentEvents("parent")
    scope.append(tool())
    scope.flushPendingSubagentEvents("parent")
    expect((scope.bubbles[0] as ToolBubble).subFrames).toBeUndefined()
    scope.onSubagentEvent({
      kind: "task",
      subtype: "task_started",
      taskId: "task",
      toolUseId: "parent",
      meta: {},
    })
    scope.replace([])
    scope.onSubagentEvent(delta("survives"))
    scope.applyPatches([
      { version: 2, op: "reset", nextMessageSeq: 0, nextSegmentSeq: 0, messages: [] },
    ])
    scope.append(tool())
    scope.flushPendingSubagentEvents("parent")
    scope.onSubagentEvent({
      kind: "task",
      subtype: "task_updated",
      taskId: "task",
      meta: { status: "completed" },
    })
    expect(JSON.stringify(scope.bubbles)).toContain("survives")
    expect((scope.bubbles[0] as ToolBubble).toolCall.task?.status).toBe("completed")
    scope.resetSubagentProjection()
    scope.replace([tool()])
    scope.onSubagentEvent({
      kind: "task",
      subtype: "task_updated",
      taskId: "task",
      meta: { status: "failed" },
    })
    scope.flushPendingSubagentEvents("parent")
    expect((scope.bubbles[0] as ToolBubble).toolCall.task).toBeUndefined()
    expect((scope.bubbles[0] as ToolBubble).subFrames).toBeUndefined()
    scope.onSubagentEvent(delta("cleanup-pending"))
    scope.replace([])
    scope.onSubagentEvent(delta("queued"))
    scope.resetSubagentProjection()
    scope.append(tool())
    scope.flushPendingSubagentEvents("parent")
    expect(JSON.stringify(scope.bubbles)).not.toContain("queued")
  })
})

it("nesting checks parent/child before allocation and mapping, preserving fallback and turn order", () => {
  const owner = new TranscriptScope()
  const parents = new Map<string, string>()
  const order: string[] = []
  const deps: SubagentToolNestingDeps = {
    hasTool: (id) => owner.hasTool(id),
    hasNestedTool: (p, c) => owner.hasNestedTool(p, c),
    appendNestedTool: (p, c) => owner.appendNestedTool(p, c),
    updateNestedTool: (p, c, patch) => owner.updateNestedTool(p, c, patch),
    parents: () => parents,
    turnEnded: () => true,
    applyToolCall: () => {
      order.push("fallback")
    },
    setTurnState: () => {
      order.push(parents.has("child") ? "mapped-turn" : "turn")
    },
    scheduleIdle: () => {
      order.push("idle")
    },
  }
  const clock = vi.spyOn(Date, "now")
  const uuid = vi.spyOn(crypto, "randomUUID")
  const badContent = new Proxy([], {
    get() {
      throw Error("must not map missing child")
    },
  })
  handleSubagentToolCall(deps, { toolCallId: "missing", content: badContent }, "absent")
  expect(order).toEqual(["fallback"])
  expect(clock).not.toHaveBeenCalled()
  expect(uuid).not.toHaveBeenCalled()
  owner.append(tool())
  handleSubagentToolCall(deps, { toolCallId: "child" }, "parent")
  expect(order).toEqual(["fallback", "mapped-turn", "idle"])
  expect(clock).toHaveBeenCalledTimes(1)
  expect(uuid).toHaveBeenCalledTimes(1)
  parents.set("missing-child", "parent")
  handleSubagentToolCallUpdate(deps, {
    toolCallId: "missing-child",
    status: "pending",
    content: badContent,
  })
  expect(order.slice(-2)).toEqual(["mapped-turn", "idle"])
  handleSubagentToolCallUpdate(deps, { toolCallId: "child", rawOutput: "updated", content: null })
  const parent = owner.bubbles[0] as ToolBubble
  const child = parent.subFrames?.[0]
  expect(child?.kind === "tool" && child.toolCall.result).toBe("updated")
  expect(child?.kind === "tool" && child.toolCall.content).toBeUndefined()
})

it("AgentSession facade remains reactive after the owner replaces its content", async () => {
  const { AgentSession } = await import("./agent-session.svelte")
  const session = new AgentSession()
  const seen: string[] = []
  const stop = $effect.root(() => {
    $effect(() => {
      seen.push(session.renderBubbles.map((b) => b.segments.map((s) => s.text).join("")).join("|"))
    })
  })
  try {
    flushSync()
    session.bubbles = [user("facade-first")]
    flushSync()
    const first = session.bubbles
    session.bubbles = [user("facade-second")]
    flushSync()
    expect(session.bubbles).not.toBe(first)
    expect(session.renderBubbles).toBe(session.bubbles)
    expect(seen).toEqual(["", "facade-first", "facade-second"])
  } finally {
    stop()
    session.detach()
  }
})
