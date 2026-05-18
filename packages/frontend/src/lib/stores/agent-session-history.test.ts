/**
 * agent-session-history.test.ts — Phase 6 tests (updated for ACP-based store)
 *
 * Note: History events (history_start, history_chunk, etc.) are now delivered
 * as ACP sessionUpdate notifications. Tests use _testInjectNotification().
 *
 * In Phase 2, history is loaded via ACP loadSession which delivers sessionUpdate
 * notifications. The history_* types here represent the ACP notification types
 * that opencode emits during session history replay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAgentSessionStore } from "./agent-session.svelte"

// SKIP: Same reason as agent-session-bubbles.test.ts — uses Slice 9 server-protocol
// shape; Slice 10 Phase 3 switched to ACP envelope shape. Will be rewritten in Phase 4.
describe.skip("agent-session history events (Phase 6 — Slice 9 shape, deprecated)", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("uuid") })
    vi.stubGlobal("location", { protocol: "http:", host: "localhost" })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function fire(store: ReturnType<typeof createAgentSessionStore>, msg: unknown) {
    // biome-ignore lint/style/noNonNullAssertion: test-only helper always present on real store
    store._testInjectNotification!(msg)
  }

  // ── clearBubbles clears existing bubbles ────────────────────────────────
  it("clearBubbles clears existing bubbles", () => {
    const store = createAgentSessionStore("a")
    // Add some live bubbles first via ACP notification
    fire(store, { type: "agent_message_chunk", text: "existing", messageId: "m0" })
    expect(store.bubbles).toHaveLength(1)

    store.clearBubbles()
    expect(store.bubbles).toHaveLength(0)
    expect(store.isLoadingHistory).toBe(false)
  })

  // Note: history_start, history_chunk, history_tool_call, history_done events
  // are opencode ACP internal notifications that arrive as sessionUpdate.
  // These are currently passed through as "unknown type" by handleSessionUpdate.
  // Phase 3+ will add specific handling when history replay is needed.
  // For now, confirm they do NOT crash the store.

  it("unknown notification types do not throw", () => {
    const store = createAgentSessionStore("a")
    expect(() =>
      fire(store, { type: "history_start", agentId: "a", sessionId: "sess-1" }),
    ).not.toThrow()
    expect(() =>
      fire(store, { type: "history_chunk", kind: "message", text: "old", messageId: "m1" }),
    ).not.toThrow()
    expect(() =>
      fire(store, { type: "history_tool_call", toolCallId: "tc1", title: "read" }),
    ).not.toThrow()
    expect(() => fire(store, { type: "history_done" })).not.toThrow()
  })

  // ── stt_partial creates user bubbles ────────────────────────────────────
  it("stt_partial creates a user bubble via ACP notification", () => {
    const store = createAgentSessionStore("a")
    fire(store, { type: "stt_partial", text: "שלום" })
    const userBubble = store.bubbles.find((b) => b.kind === "user")
    expect(userBubble).toBeDefined()
    expect(store.getRecordingId()).toBeNull()
  })

  // ── B10: addTranslatedSegment stores recordingId ────────────────────────
  it("addTranslatedSegment is no-op for nonexistent messageId", () => {
    const store = createAgentSessionStore("a")
    fire(store, { type: "stt_partial", text: "שלום" })
    store.addTranslatedSegment("nonexistent-id", "message", "orig", "translated")
    expect(store.bubbles).toHaveLength(1) // only user bubble unchanged
  })
})
