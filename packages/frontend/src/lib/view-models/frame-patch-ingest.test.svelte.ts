// @vitest-environment jsdom

import type { SessionNotification } from "@agentclientprotocol/sdk"
import {
  createInitialSessionState,
  type Patch,
  reduce,
  type SessionState,
} from "@drive-coding/core/session"
import { toWireText } from "@drive-coding/core/session/testing"
import type { AcpClient } from "@drive-coding/provider/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LocalSessionView } from "$lib/session/local-session-view"
import { RemoteSessionView } from "$lib/session/remote-session-view"
import { AgentSession } from "./agent-session.svelte"

const updates = [
  {
    sessionUpdate: "user_message_chunk",
    messageId: "user-1",
    content: { type: "text", text: "Question" },
  },
  {
    sessionUpdate: "agent_message_chunk",
    messageId: "agent-1",
    content: { type: "text", text: "Answer" },
  },
  {
    sessionUpdate: "agent_message_chunk",
    messageId: "agent-1",
    content: { type: "text", text: " continues" },
  },
] as const

const activeViews: Array<LocalSessionView | RemoteSessionView> = []

function fakeClient(): AcpClient {
  return { close: vi.fn() } as unknown as AcpClient
}

function local(): { view: LocalSessionView; send: (update: unknown) => void } {
  const view = new LocalSessionView({ cwd: "/proj", cliKind: "claude" })
  view.adopt({ client: fakeClient(), sessionId: "c3-local" })
  activeViews.push(view)
  return {
    view,
    send: (update) =>
      view.observerCallbacks.onUpdate?.({ sessionId: "c3-local", update } as SessionNotification),
  }
}

function remote(): { view: RemoteSessionView; connect: () => Promise<void> } {
  const initial = createInitialSessionState({ sessionId: "c3-remote" })
  let state: SessionState = initial
  const patches: Patch[] = []
  for (const update of updates) {
    const next = reduce(state, update)
    state = next.state
    patches.push(...next.patches)
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          toWireText([
            { event: "snapshot", data: JSON.stringify(initial) },
            ...patches.map((patch) => ({ event: "patch", data: JSON.stringify(patch) })),
          ]),
        ),
      )
    },
  })
  const view = new RemoteSessionView("c3-agent", "http://localhost", {
    _fetch: async () => ({ ok: true, status: 200, body }) as Response,
  })
  activeViews.push(view)
  return { view, connect: () => view.connect() }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25))
}

function display(agent: AgentSession): string[] {
  return agent.bubbles.flatMap((bubble) =>
    bubble.kind === "user" || bubble.kind === "message" || bubble.kind === "thought"
      ? [bubble.segments.map((segment) => segment.text).join("")]
      : [],
  )
}

afterEach(async () => {
  for (const view of activeViews) {
    if (view instanceof LocalSessionView) view.dispose()
    else await view.close()
  }
  activeViews.length = 0
})

describe("C3: stream is sole display source", () => {
  it("does not render raw local callbacks when the real view stream is muted", async () => {
    const feed = local()
    Object.defineProperty(feed.view, "patches", { value: new ReadableStream() })
    const agent = new AgentSession({ view: feed.view })
    for (const update of updates) feed.send(update)
    feed.send({ sessionUpdate: "usage_update", used: 5, size: 10 })
    feed.send({
      sessionUpdate: "plan",
      entries: [{ content: "Hidden", status: "pending", priority: "high" }],
    })
    await tick()
    expect(display(agent)).toEqual([])
    expect(agent.contextUsage).toBeNull()
    expect(agent.planStore.order).toEqual([])
  })

  it("applies ordered user and agent chunks once from the real local view", async () => {
    const localFeed = local()
    const localAgent = new AgentSession({ view: localFeed.view })
    for (const update of updates) localFeed.send(update)
    await tick()
    expect(display(localAgent)).toEqual(["Question", "Answer continues"])
  })

  it("applies ordered user and agent chunks once from the real remote view", async () => {
    const remoteFeed = remote()
    const remoteAgent = new AgentSession({ view: remoteFeed.view })
    await remoteFeed.connect()
    await tick()

    expect(display(remoteAgent)).toEqual(["Question", "Answer continues"])
  })

  it("F2: routes a local image without metadata and an opaque remote plan through display owners", async () => {
    const localFeed = local()
    const localAgent = new AgentSession({ view: localFeed.view })
    localFeed.send({
      sessionUpdate: "user_message_chunk",
      content: { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    })
    await tick()
    expect(localAgent.bubbles[0]?.kind).toBe("user")
    if (localAgent.bubbles[0]?.kind === "user") {
      expect(localAgent.bubbles[0].attachments).toHaveLength(1)
    }

    const remoteFeed = remote()
    const remoteAgent = new AgentSession({ view: remoteFeed.view })
    await remoteFeed.connect()
    await tick()
    expect(display(remoteAgent)).toEqual(["Question", "Answer continues"])
  })

  it("F3: rejects queued frames from an old adoption of the same real local view", async () => {
    const feed = local()
    const agent = new AgentSession({ view: feed.view })
    feed.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "old",
      content: { type: "text", text: "old" },
    })
    feed.view.adopt({ client: fakeClient(), sessionId: "c3-new" })
    feed.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "new",
      content: { type: "text", text: "new" },
    })
    await tick()
    expect(display(agent)).toEqual(["new"])
  })

  it("F4: emits ordered frame snapshots before the view advances to a later mode", async () => {
    const feed = local()
    const reader = feed.view.patches.getReader()
    feed.send({ sessionUpdate: "current_mode_update", currentModeId: "first" })
    feed.send({ sessionUpdate: "current_mode_update", currentModeId: "second" })
    const first = (await reader.read()).value as
      | { frames?: Array<{ state?: SessionState }> }
      | undefined
    const second = (await reader.read()).value as
      | { frames?: Array<{ state?: SessionState }> }
      | undefined
    expect(first?.frames?.[0]?.state?.modes?.currentModeId).toBe("first")
    expect(second?.frames?.[0]?.state?.modes?.currentModeId).toBe("second")
    await reader.cancel()
  })

  it("keeps metadata out of the raw callback and applies it after the stream tick", async () => {
    const feed = local()
    const agent = new AgentSession({ view: feed.view })
    feed.send({ sessionUpdate: "usage_update", used: 25_000, size: 200_000 })
    feed.send({ sessionUpdate: "session_info_update", title: "Frame title" })
    feed.send({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "commit", description: "Commit" }],
    })
    expect([agent.contextUsage, agent.sessionTitle, agent.availableCommands.length]).toEqual([
      null,
      "",
      0,
    ])
    await tick()
    expect(agent.contextUsage).toEqual({ used: 25_000, size: 200_000, cost: undefined })
    expect(agent.sessionTitle).toBe("Frame title")
    expect(agent.availableCommands.map((command) => command.name)).toEqual(["commit"])
  })

  it("updates turn state and nested tools after the frame tick", async () => {
    const feed = local()
    const agent = new AgentSession({ view: feed.view })
    feed.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "turn",
      content: { type: "text", text: "Reply" },
    })
    expect(agent.turnState).not.toBe("responding")
    await tick()
    expect(agent.turnState).toBe("responding")
    expect(display(agent)).toEqual(["Reply"])
    feed.send({
      sessionUpdate: "tool_call",
      toolCallId: "parent-2",
      title: "Task",
      kind: "other",
      status: "pending",
    })
    feed.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "child-2",
      title: "Run",
      kind: "execute",
      status: "pending",
      _meta: { claudeCode: { parentToolUseId: "parent-2" } },
    })
    expect(
      agent.bubbles.some(
        (bubble) => bubble.kind === "tool" && bubble.toolCall.toolCallId === "parent-2",
      ),
    ).toBe(false)
    await tick()
    const parent = agent.bubbles.find(
      (bubble) => bubble.kind === "tool" && bubble.toolCall.toolCallId === "parent-2",
    )
    expect(
      parent?.kind === "tool" &&
        parent.subFrames?.some(
          (child) => child.kind === "tool" && child.toolCall.toolCallId === "child-2",
        ),
    ).toBe(true)
  })

  it("F3: dispose resolves a pending real-view read and late enqueue stays silent", async () => {
    const feed = local()
    const reader = feed.view.patches.getReader()
    const pending = reader.read()
    feed.view.dispose()
    expect(await pending).toMatchObject({ done: true })
    expect(() =>
      feed.send({
        sessionUpdate: "agent_message_chunk",
        messageId: "late",
        content: { type: "text", text: "late" },
      }),
    ).not.toThrow()
    expect(await reader.read()).toMatchObject({ done: true })
    reader.releaseLock()
  })

  it("F4: remote mixed batch keeps per-frame modes and ordered tool/plan display", async () => {
    const initial = createInitialSessionState({ sessionId: "c3-mixed" })
    const mixed = [
      { sessionUpdate: "current_mode_update", currentModeId: "first" },
      {
        sessionUpdate: "tool_call",
        toolCallId: "parent",
        title: "Task",
        kind: "other",
        status: "pending",
      },
      { sessionUpdate: "current_mode_update", currentModeId: "second" },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "child",
        title: "Run",
        kind: "execute",
        status: "pending",
        _meta: { claudeCode: { parentToolUseId: "parent" } },
      },
      {
        sessionUpdate: "plan",
        entries: [{ content: "Step", status: "pending", priority: "high" }],
      },
    ]
    const wire =
      toWireText([{ event: "snapshot", data: JSON.stringify(initial) }]) +
      `event: update\nid: 1\ndata: ${JSON.stringify(mixed.map((update) => ({ method: "session/update", params: { sessionId: "c3-mixed", update } })))}\n\n`
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(wire))
      },
    })
    const view = new RemoteSessionView("c3-agent", "http://localhost", {
      _fetch: async () => ({ ok: true, status: 200, body }) as Response,
    })
    activeViews.push(view)
    const agent = new AgentSession({ view })
    await view.connect()
    await tick()
    expect(agent.modes?.currentModeId).toBe("second")
    expect(agent.planStore.order).toHaveLength(1)
    const parent = agent.bubbles.find(
      (bubble) => bubble.kind === "tool" && bubble.toolCall.toolCallId === "parent",
    )
    expect(
      parent?.kind === "tool" &&
        parent.subFrames?.some(
          (child) => child.kind === "tool" && child.toolCall.toolCallId === "child",
        ),
    ).toBe(true)
  })

  it("F2: preserves parent, child, SDK event, orphan, and plan display order", async () => {
    const feed = local()
    const agent = new AgentSession({ view: feed.view })
    feed.view.observerCallbacks.onExtNotification?.("_claude/sdkMessage", {
      message: {
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "parent",
      },
    })
    feed.send({
      sessionUpdate: "tool_call",
      toolCallId: "parent",
      title: "Task",
      kind: "other",
      status: "pending",
    })
    feed.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "child",
      title: "Run",
      kind: "execute",
      status: "pending",
      _meta: { claudeCode: { parentToolUseId: "parent" } },
    })
    feed.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "child",
      status: "completed",
      rawOutput: "done",
    })
    feed.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "orphan",
      title: "Orphan",
      status: "pending",
      _meta: { claudeCode: { parentToolUseId: "missing" } },
    })
    feed.send({
      sessionUpdate: "plan",
      entries: [{ content: "Step", status: "pending", priority: "high" }],
    })
    await tick()

    const parent = agent.bubbles.find(
      (bubble) => bubble.kind === "tool" && bubble.toolCall.toolCallId === "parent",
    )
    expect(parent?.kind).toBe("tool")
    if (parent?.kind === "tool") {
      const child = parent.subFrames?.find(
        (bubble) => bubble.kind === "tool" && bubble.toolCall.toolCallId === "child",
      )
      expect(child?.kind === "tool" && child.toolCall.status).toBe("completed")
      expect(parent.toolCall.task).toBeDefined()
    }
    expect(
      agent.bubbles.filter(
        (bubble) => bubble.kind === "tool" && bubble.toolCall.toolCallId === "child",
      ),
    ).toHaveLength(0)
    expect(
      agent.bubbles.filter(
        (bubble) => bubble.kind === "tool" && bubble.toolCall.toolCallId === "orphan",
      ),
    ).toHaveLength(1)
    expect(agent.planStore.order).toHaveLength(1)
  })
})
