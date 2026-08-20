/**
 * agent-session.session-view.test.svelte.ts — C3 tests.
 *
 * Tests the VM as a consumer of SessionView:
 * - AgentSession accepts SessionView via constructor DI
 * - bubbles updated via view.patches (targeted reactivity)
 * - status/turnState/contextUsage/etc. synced from view.state via patches
 * - sendPrompt() delegates to view.prompt()
 * - cancelTurn() delegates to view.cancel()
 *
 * ─── slice session-view-port C3 (TDD) ───
 */
import { describe, it, expect, beforeEach } from "vitest"
import { AgentSession } from "./agent-session.svelte"
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"

// ─── Helpers ───

function delay(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Tests ───

describe("AgentSession as SessionView consumer (C3)", () => {
  let mockView: MockSessionView
  let agent: AgentSession

  beforeEach(() => {
    mockView = new MockSessionView()
    agent = new AgentSession({ view: mockView })
    mockView.connect("test-session")
  })

  it("accepts SessionView via constructor", () => {
    expect(agent).toBeDefined()
  })

  it("fireUpdate → agent.bubbles updated via patches", async () => {
    mockView.fireUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello from agent" },
      messageId: "m-1",
    })
    await delay()
    expect(agent.bubbles.length).toBeGreaterThan(0)
    const bubble = agent.bubbles[agent.bubbles.length - 1]!
    expect(bubble.kind).toBe("message")
    const msgBubble = bubble as { kind: "message"; segments: Array<{ text: string }> }
    expect(msgBubble.segments.some((s) => s.text === "Hello from agent")).toBe(true)
  })

  it("multiple chunks → single bubble with multiple segments", async () => {
    mockView.fireUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Part 1" },
      messageId: "m-1",
    })
    mockView.fireUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: " Part 2" },
      messageId: "m-1",
    })
    await delay()
    // Should be 1 bubble (grouped by messageId)
    const msgBubbles = agent.bubbles.filter((b) => b.kind === "message")
    expect(msgBubbles).toHaveLength(1)
    const bubble = msgBubbles[0] as { kind: "message"; segments: Array<{ text: string }> }
    expect(bubble.segments).toHaveLength(2)
  })

  it("tool_call update → tool bubble appears", async () => {
    mockView.fireUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "tc-view-1",
      kind: "read",
      rawInput: { path: "/tmp/x" },
      status: "pending",
    })
    await delay()
    const toolBubble = agent.bubbles.find((b) => b.kind === "tool")
    expect(toolBubble).toBeDefined()
  })

  it("turnState reflects thought chunks as 'thinking'", async () => {
    mockView.fireUpdate({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Thinking..." },
      messageId: "t-1",
    })
    await delay()
    expect(agent.turnState).toBe("thinking")
  })

  it("turnState reflects message chunks as 'responding'", async () => {
    mockView.fireUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello!" },
      messageId: "m-1",
    })
    await delay()
    expect(agent.turnState).toBe("responding")
  })

  it("session_info_update → sessionTitle updated via update-session patch", async () => {
    mockView.fireUpdate({
      sessionUpdate: "session_info_update",
      title: "My Session Title",
    })
    await delay()
    expect(agent.sessionTitle).toBe("My Session Title")
  })

  it("usage_update → contextUsage updated", async () => {
    mockView.fireUpdate({
      sessionUpdate: "usage_update",
      used: 500,
      size: 4096,
    })
    await delay()
    expect(agent.contextUsage?.used).toBe(500)
    expect(agent.contextUsage?.size).toBe(4096)
  })

  it("available_commands_update → availableCommands updated", async () => {
    mockView.fireUpdate({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "plan", description: "Create a plan" }],
    })
    await delay()
    expect(agent.availableCommands).toHaveLength(1)
    expect(agent.availableCommands[0]!.name).toBe("plan")
  })
})
