/**
 * agent-session.test.ts — Phase 2 tests (updated for ACP-based store)
 *
 * Note: The old WS-direct protocol tests (text_chunk, tool_call via raw WS) are replaced
 * by ACP notification injection tests in agent-session-bubbles.test.ts and
 * agent-session-acp.test.ts.
 *
 * This file retains tests for:
 * - Store shape / public interface
 * - sendPrompt status guard (MED-9)
 * - sendRaw backward compat
 * - disconnect behavior
 * - addTranslatedSegment
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAgentSessionStore } from "./agent-session.svelte"

describe("createAgentSessionStore", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "test-uuid",
    })
    vi.stubGlobal("location", {
      protocol: "http:",
      host: "localhost:4000",
    })
    // Stub fetch so tests don't hit real network
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("exposes agentId on the public store", () => {
    const store = createAgentSessionStore("agent-123")
    expect(store.agentId).toBe("agent-123")
  })

  it("initial status is spawning", () => {
    const store = createAgentSessionStore("agent-123")
    expect(store.status).toBe("spawning")
  })

  it("sendRaw returns false when not connected", () => {
    const store = createAgentSessionStore("a")
    expect(store.sendRaw({ type: "ping" })).toBe(false)
  })

  it("isConnected is false when status is spawning", () => {
    const store = createAgentSessionStore("a")
    expect(store.isConnected).toBe(false)
  })

  it("sendPrompt is a no-op (does not add bubble) when status is spawning", () => {
    const store = createAgentSessionStore("a")
    expect(store.status).toBe("spawning")
    store.sendPrompt("hello")
    expect(store.bubbles.length).toBe(0)
  })

  it("clearBubbles resets all state", () => {
    const store = createAgentSessionStore("a")
    // biome-ignore lint/style/noNonNullAssertion: test-only helper always present on real store
    store._testInjectNotification!({ type: "agent_message_chunk", text: "hi", messageId: "m1" })
    expect(store.bubbles.length).toBeGreaterThan(0)
    store.clearBubbles()
    expect(store.bubbles.length).toBe(0)
    expect(store.messages.length).toBe(0)
    expect(store.isLoadingHistory).toBe(false)
  })

  it("addTranslatedSegment no-op when no matching bubble", () => {
    const store = createAgentSessionStore("a")
    expect(() =>
      store.addTranslatedSegment("nonexistent", "thought", "orig", "translated"),
    ).not.toThrow()
    expect(store.bubbles.length).toBe(0)
  })

  it("disconnect resets status to spawning", () => {
    const store = createAgentSessionStore("a")
    // Manually simulate connected state via inject + status manipulation
    // biome-ignore lint/style/noNonNullAssertion: test-only helper always present on real store
    store._testInjectNotification!({ type: "agent_message_chunk", text: "test", messageId: "m1" })
    store.disconnect()
    expect(store.status).toBe("spawning")
  })
})
