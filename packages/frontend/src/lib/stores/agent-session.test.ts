import { ClientMessage, ServerMessage } from "@drive-coding/core"
import { type } from "arktype"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLastWs, installWebSocketMock, MockWebSocket } from "./__test-helpers__"
import { type AgentSessionPublic, createAgentSessionStore } from "./agent-session.svelte"

describe("createAgentSessionStore", () => {
  beforeEach(() => {
    installWebSocketMock()
    // mock crypto.randomUUID for stable IDs in tests
    vi.stubGlobal("crypto", {
      randomUUID: () => "test-uuid",
    })
    // mock location for WS URL
    vi.stubGlobal("location", {
      protocol: "http:",
      host: "localhost:4000",
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("exposes agentId on the public store", () => {
    const store: AgentSessionPublic = createAgentSessionStore("agent-123")
    expect(store.agentId).toBe("agent-123")
  })

  it("sendPrompt produces ClientMessage-conforming payload", async () => {
    const store = createAgentSessionStore("a")
    store.connect()
    // wait for WS onopen microtask
    await new Promise<void>((r) => queueMicrotask(r))
    const ws = getLastWs()
    store.sendPrompt("hello")
    expect(ws.sent).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: test invariant — sent has 1 item confirmed above
    const payload = JSON.parse(ws.sent[0]!)
    const result = ClientMessage(payload)
    expect(result instanceof type.errors).toBe(false)
  })

  it("cancel produces ClientMessage-conforming payload", async () => {
    const store = createAgentSessionStore("a")
    store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    const ws = getLastWs()
    store.cancel()
    expect(ws.sent).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: test invariant — sent has 1 item confirmed above
    const payload = JSON.parse(ws.sent[0]!)
    const result = ClientMessage(payload)
    expect(result instanceof type.errors).toBe(false)
  })

  it("sendRaw returns false when WS not open", () => {
    const store = createAgentSessionStore("a")
    // Not connected — no WS
    expect(store.sendRaw({ type: "ping" })).toBe(false)
  })

  it("status returns to disconnected on WS close", async () => {
    const store = createAgentSessionStore("a")
    store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    expect(store.status).not.toBe("disconnected")
    const ws = getLastWs()
    ws.close()
    expect(store.status).toBe("disconnected")
  })

  it("merges tool_call updates by toolCallId into a single message", async () => {
    const store = createAgentSessionStore("a")
    store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    const ws = getLastWs()

    ws.onmessage?.({
      data: JSON.stringify({
        type: "tool_call",
        toolCallId: "t1",
        title: "Reading...",
        kind: "read",
        status: "pending",
      }),
    })
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]).toMatchObject({ toolStatus: "pending" })

    ws.onmessage?.({
      data: JSON.stringify({
        type: "tool_call",
        toolCallId: "t1",
        title: "Reading...",
        kind: "read",
        status: "completed",
        content: "data",
      }),
    })
    expect(store.messages).toHaveLength(1) // לא 2!
    expect(store.messages[0]?.toolStatus).toBe("completed")
    expect(store.messages[0]?.toolContent).toBe("data")
  })

  // ── Reconnect tests (Slice 7 fix) ──────────────────────────────────────────

  it("schedules reconnect on unexpected WS close (error banner)", async () => {
    vi.useFakeTimers()
    const store = createAgentSessionStore("a")
    store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    const ws = getLastWs()

    // Simulate server-side close (not intentional)
    ws.close()

    expect(store.status).toBe("disconnected")
    expect(store.error).toContain("מתחבר מחדש")

    vi.useRealTimers()
  })

  it("reconnects after delay on unexpected close", async () => {
    vi.useFakeTimers()
    const store = createAgentSessionStore("a")
    store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    const ws = getLastWs()
    const initialInstanceCount = MockWebSocket.instances.length

    ws.close() // unexpected close → should schedule reconnect

    // Fast-forward past first retry delay (1000ms)
    vi.advanceTimersByTime(1500)
    await new Promise<void>((r) => queueMicrotask(r))

    expect(MockWebSocket.instances.length).toBeGreaterThan(initialInstanceCount)

    vi.useRealTimers()
  })

  it("does NOT reconnect on intentional disconnect", async () => {
    vi.useFakeTimers()
    const store = createAgentSessionStore("a")
    store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    const initialCount = MockWebSocket.instances.length

    store.disconnect() // intentional

    expect(store.status).toBe("disconnected")
    expect(store.error).toBeNull()

    // Fast-forward — no reconnect should happen
    vi.advanceTimersByTime(5000)
    await new Promise<void>((r) => queueMicrotask(r))
    expect(MockWebSocket.instances.length).toBe(initialCount)

    vi.useRealTimers()
  })

  it("resets retryCount to 0 on successful reconnect", async () => {
    vi.useFakeTimers()
    const store = createAgentSessionStore("a")
    store.connect()
    await new Promise<void>((r) => queueMicrotask(r))

    // Simulate unexpected close → reconnect
    getLastWs().close()
    vi.advanceTimersByTime(1500)
    await new Promise<void>((r) => queueMicrotask(r))

    // New WS connected (onopen fires)
    await new Promise<void>((r) => queueMicrotask(r))

    // After reconnect succeeds — the error should be cleared by "connected" message
    const newWs = getLastWs()
    newWs.onmessage?.({ data: JSON.stringify({ type: "connected", agentId: "a" }) })
    expect(store.status).toBe("connected")
    expect(store.error).toBeNull()

    vi.useRealTimers()
  })

  it("handles every ServerMessage variant without throwing", async () => {
    const store = createAgentSessionStore("a")
    store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    const ws = getLastWs()

    const variants: Array<unknown> = [
      { type: "hello", version: "0.1.0" },
      { type: "pong", echoOf: "x", serverTime: 0 },
      { type: "connected", agentId: "a" },
      { type: "thinking" },
      { type: "text_chunk", kind: "message", text: "hi" },
      { type: "text_chunk", kind: "thought", text: "thinking..." },
      { type: "tool_call", toolCallId: "t1", title: "read" },
      {
        type: "tool_call",
        toolCallId: "t1",
        title: "Reading...",
        kind: "read",
        status: "completed",
        locations: ["/x"],
        content: "abc",
      },
      { type: "done", stopReason: "end_turn" },
      { type: "error", code: "X", message: "y" },
      { type: "stt_partial", text: "שלום" },
      { type: "audio_chunk", mp3Base64: "abc" },
      { type: "translation", original: "hi", translated: "שלום" },
    ]

    for (const v of variants) {
      // First validate the test variant is a valid ServerMessage
      const parsed = ServerMessage(v)
      if (parsed instanceof type.errors) {
        throw new Error(
          `test variant לא תואם ServerMessage: ${JSON.stringify(v)}\n${parsed.summary}`,
        )
      }
      // Then verify the store handles it without throwing
      expect(() => ws.onmessage?.({ data: JSON.stringify(v) })).not.toThrow()
    }
  })
})
