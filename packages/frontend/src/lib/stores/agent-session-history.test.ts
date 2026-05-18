/**
 * agent-session-history.test.ts — Phase 4 rewrite (ACP envelope shape)
 *
 * Tests for history-related behavior in agent-session store.
 *
 * In Slice 10, history is loaded via ACP loadSession which delivers sessionUpdate
 * notifications as ACP envelopes. History replay tests (history_start etc.)
 * are deferred to a future slice when opencode implements full history via ACP.
 *
 * This file covers clearBubbles() and robustness against unknown notification types.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAgentSessionStore } from "./agent-session.svelte"

function makeAcp(sessionId: string, update: Record<string, unknown>) {
  return { sessionId, update }
}

describe("agent-session history behavior (ACP shape, Slice 10)", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("uuid") })
    vi.stubGlobal("location", { protocol: "http:", host: "localhost" })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function fire(store: ReturnType<typeof createAgentSessionStore>, notification: unknown) {
    // biome-ignore lint/style/noNonNullAssertion: test-only helper always present on real store
    store._testInjectNotification!(notification)
  }

  // ── clearBubbles clears existing bubbles ────────────────────────────────
  it("clearBubbles() clears bubbles and resets isLoadingHistory", () => {
    const store = createAgentSessionStore("agent-a")
    // Add some bubbles via ACP notification
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "existing" },
      }),
    )
    expect(store.bubbles).toHaveLength(1)

    store.clearBubbles()
    expect(store.bubbles).toHaveLength(0)
    expect(store.isLoadingHistory).toBe(false)
  })

  // ── Unknown / future notification types do not crash the store ────────────
  it("unknown sessionUpdate type does not throw", () => {
    const store = createAgentSessionStore("agent-a")
    expect(() =>
      fire(
        store,
        makeAcp("sess-1", {
          sessionUpdate: "plan",
          content: { type: "text", text: "planning..." },
        }),
      ),
    ).not.toThrow()
    expect(() =>
      fire(store, makeAcp("sess-1", { sessionUpdate: "available_commands_update" })),
    ).not.toThrow()
    expect(() =>
      fire(store, makeAcp("sess-1", { sessionUpdate: "current_mode_update", mode: "assistant" })),
    ).not.toThrow()
    expect(store.bubbles).toHaveLength(0)
  })

  // ── Valid ACP envelope with missing update content does not create bubbles ──
  // Note: the store expects ACP SDK-shaped notifications (always has .update).
  // Completely malformed envelopes (null/missing update) are not expected from SDK.
  it("ACP envelope with empty update object creates no bubble and does not crash", () => {
    const store = createAgentSessionStore("agent-a")
    // { sessionId, update: {} } — valid envelope, unknown sessionUpdate type → no bubble
    expect(() => fire(store, { sessionId: "sess-1", update: {} })).not.toThrow()
    expect(store.bubbles).toHaveLength(0)
  })
})
