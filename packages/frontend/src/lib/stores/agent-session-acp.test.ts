/**
 * agent-session-acp.test.ts — Phase 2 TDD
 *
 * Tests for the NEW ACP-based flow in agent-session.svelte.ts:
 * 1. State machine: spawning → connecting → connected
 * 2. sendPrompt rejected if status != "connected" (MED-9)
 * 3. Bubble accumulation from mock sessionUpdate stream
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAgentSessionStore } from "./agent-session.svelte"

// ── Minimal mock for createAcpClient ─────────────────────────────────────────

type OnUpdate = (n: unknown) => void

class MockAcpClient {
  onUpdate: OnUpdate | null = null

  constructor(onUpdate: OnUpdate) {
    this.onUpdate = onUpdate
  }

  triggerUpdate(notification: unknown) {
    this.onUpdate?.(notification)
  }
}

let lastAcpClient: MockAcpClient | null = null

// ── Top-level vi.mock (hoisted before all tests) ──────────────────────────────

vi.mock("$lib/acp/client", () => ({
  createAcpClient: vi.fn(async (_agentId: string, onUpdate: OnUpdate) => {
    const client = new MockAcpClient(onUpdate)
    lastAcpClient = client
    return {
      conn: {},
      capabilities: {},
      newSession: async (_opts: unknown) => ({ sessionId: "mock-session-id" }),
      loadSession: async (_opts: unknown) => ({ sessionId: "mock-session-id" }),
      listSessions: async () => ({ sessions: [] }),
      prompt: async (_sessionId: string, _text: string) => ({ stream: null }),
      cancel: async (_sessionId: string) => ({}),
      close: vi.fn(),
    }
  }),
}))

// ── Mock fetch ────────────────────────────────────────────────────────────────

function makeFetchMock() {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const urlStr = String(url)
    if (urlStr.includes("/session-attached") && opts?.method === "POST") {
      return { ok: true, json: async () => ({}) }
    }
    return { ok: true, json: async () => ({}) }
  })
}

describe("agent-session ACP state machine (Phase 2)", () => {
  beforeEach(() => {
    lastAcpClient = null
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("uuid") })
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
    vi.stubGlobal("fetch", makeFetchMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  // ── 1. State machine transitions ───────────────────────────────────────────

  it("initial status is 'spawning' before connect()", () => {
    const store = createAgentSessionStore("test-agent")
    expect(store.status).toBe("spawning")
  })

  it("transitions to 'connected' after successful ACP handshake", async () => {
    const store = createAgentSessionStore("test-agent")
    expect(store.status).toBe("spawning")

    await store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    await new Promise<void>((r) => queueMicrotask(r))

    expect(store.status).toBe("connected")
  })

  // ── 2. sendPrompt guard (MED-9) ────────────────────────────────────────────

  it("MED-9: sendPrompt does not add bubble when status is 'spawning'", () => {
    const store = createAgentSessionStore("test-agent")
    expect(store.status).toBe("spawning")
    store.sendPrompt("hello")
    // No bubble added — not connected
    expect(store.bubbles.length).toBe(0)
  })

  it("MED-9: sendPrompt adds user bubble when status is 'connected'", async () => {
    const store = createAgentSessionStore("test-agent")
    await store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    await new Promise<void>((r) => queueMicrotask(r))

    expect(store.status).toBe("connected")
    store.sendPrompt("hello from connected")
    const userBubble = store.bubbles.find((b) => b.kind === "user")
    expect(userBubble).toBeDefined()
    expect(userBubble?.segments[0]?.text).toBe("hello from connected")
  })

  // ── 3. Bubble accumulation from sessionUpdate ──────────────────────────────

  it("accumulates message bubbles from agent_message_chunk notifications", async () => {
    const store = createAgentSessionStore("test-agent")
    await store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    await new Promise<void>((r) => queueMicrotask(r))

    if (!lastAcpClient) throw new Error("lastAcpClient not set")

    // ACP envelope shape: { sessionId, update: { sessionUpdate, content } }
    lastAcpClient.triggerUpdate({
      sessionId: "mock-session-id",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "שלום, " },
      },
    })
    lastAcpClient.triggerUpdate({
      sessionId: "mock-session-id",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "אני כאן." },
      },
    })

    const messageBubbles = store.bubbles.filter((b) => b.kind === "message")
    expect(messageBubbles).toHaveLength(1)
    expect(messageBubbles[0]?.segments[0]?.text).toBe("שלום, אני כאן.")
  })

  it("accumulates thought bubbles from agent_thought_chunk notifications", async () => {
    const store = createAgentSessionStore("test-agent")
    await store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    await new Promise<void>((r) => queueMicrotask(r))

    if (!lastAcpClient) throw new Error("lastAcpClient not set")
    lastAcpClient.triggerUpdate({
      sessionId: "mock-session-id",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "I need to think about this..." },
      },
    })

    const thoughtBubbles = store.bubbles.filter((b) => b.kind === "thought")
    expect(thoughtBubbles).toHaveLength(1)
    expect(thoughtBubbles[0]?.segments[0]?.text).toBe("I need to think about this...")
  })

  it("creates tool bubbles from tool_call notifications", async () => {
    const store = createAgentSessionStore("test-agent")
    await store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    await new Promise<void>((r) => queueMicrotask(r))

    if (!lastAcpClient) throw new Error("lastAcpClient not set")
    lastAcpClient.triggerUpdate({
      sessionId: "mock-session-id",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "Reading file...",
        kind: "read",
      },
    })

    const toolBubbles = store.bubbles.filter((b) => b.kind === "tool")
    expect(toolBubbles).toHaveLength(1)
    expect(toolBubbles[0]?.segments[0]?.toolCallId).toBe("tc-1")
    expect(toolBubbles[0]?.segments[0]?.toolTitle).toBe("Reading file...")
  })
})
