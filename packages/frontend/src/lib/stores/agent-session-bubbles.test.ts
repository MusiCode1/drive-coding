/**
 * agent-session-bubbles.test.ts — Phase 4 rewrite (ACP envelope shape)
 *
 * Tests for the `bubbles` state and grouping logic in agent-session store.
 * Uses _testInjectNotification() to bypass ACP handshake in tests.
 *
 * ACP shape: { sessionId: string, update: { sessionUpdate: "<kind>", ...payload } }
 *
 * Bubble grouping rules (Slice 10):
 *   - agent_message_chunk → "message" bubble (consecutive → same bubble, text appended)
 *   - agent_thought_chunk → "thought" bubble (consecutive → same bubble)
 *   - kind change → new bubble
 *   - tool_call → tool bubble (merged by toolCallId)
 *   - tool_call_update → narration update on existing tool bubble (FE-side)
 *
 * NOT supported (removed in Slice 10):
 *   - messageId-based grouping (ACP chunks don't carry messageId at chunk level)
 *   - stt_partial (user bubble added synchronously in sendPrompt, not via ACP)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAgentSessionStore } from "./agent-session.svelte"

// ── ACP envelope helper ────────────────────────────────────────────────────────

function makeAcp(sessionId: string, update: Record<string, unknown>) {
  return { sessionId, update }
}

// ── Test setup ─────────────────────────────────────────────────────────────────

describe("agent-session bubble grouping (ACP shape, Slice 10)", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("uuid") })
    vi.stubGlobal("location", { protocol: "http:", host: "localhost" })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function makeStore() {
    return createAgentSessionStore("agent-a")
  }

  function fire(store: ReturnType<typeof makeStore>, notification: unknown) {
    // biome-ignore lint/style/noNonNullAssertion: test-only helper always present on real store
    store._testInjectNotification!(notification)
  }

  // ── 1: first agent_message_chunk creates a message bubble ─────────────────
  it("first agent_message_chunk creates a message bubble with one segment", () => {
    const store = makeStore()
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "שלום" },
      }),
    )
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.kind).toBe("message")
    expect(store.bubbles[0]?.segments).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.text).toBe("שלום")
  })

  // ── 2: consecutive message chunks → text concatenated in same bubble ──────
  it("consecutive agent_message_chunks → text appended to same bubble segment", () => {
    const store = makeStore()
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "A" },
      }),
    )
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "B" },
      }),
    )
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "C" },
      }),
    )
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.segments).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.text).toBe("ABC")
  })

  // ── 3: kind change → new bubble ───────────────────────────────────────────
  it("kind change (thought → message) creates a new bubble", () => {
    const store = makeStore()
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thinking" },
      }),
    )
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "answer" },
      }),
    )
    expect(store.bubbles).toHaveLength(2)
    expect(store.bubbles[0]?.kind).toBe("thought")
    expect(store.bubbles[1]?.kind).toBe("message")
  })

  // ── 4: thought chunks concatenate in same bubble ──────────────────────────
  it("consecutive agent_thought_chunks → text appended to same thought bubble", () => {
    const store = makeStore()
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "part A " },
      }),
    )
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "part B" },
      }),
    )
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.kind).toBe("thought")
    expect(store.bubbles[0]?.segments).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.text).toBe("part A part B")
  })

  // ── 5: chronological: thought → tool → thought → message = 4 bubbles ─────
  it("chronological: thought → tool → thought → message = 4 distinct bubbles", () => {
    const store = makeStore()
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "first" },
      }),
    )
    fire(
      store,
      makeAcp("sess-1", { sessionUpdate: "tool_call", toolCallId: "tc1", title: "read file" }),
    )
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "second" },
      }),
    )
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "answer" },
      }),
    )
    expect(store.bubbles).toHaveLength(4)
    expect(store.bubbles[0]?.kind).toBe("thought")
    expect(store.bubbles[1]?.kind).toBe("tool")
    expect(store.bubbles[2]?.kind).toBe("thought")
    expect(store.bubbles[3]?.kind).toBe("message")
  })

  // ── 6: tool_call creates tool bubble with toolCallId + title ──────────────
  it("tool_call creates a tool bubble with toolCallId and title in segment", () => {
    const store = makeStore()
    fire(
      store,
      makeAcp("sess-1", { sessionUpdate: "tool_call", toolCallId: "tc1", title: "read file" }),
    )
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.kind).toBe("tool")
    expect(store.bubbles[0]?.segments[0]?.toolCallId).toBe("tc1")
    expect(store.bubbles[0]?.segments[0]?.toolTitle).toBe("read file")
  })

  // ── 7: tool_call with same toolCallId → merges (no duplicate) ────────────
  it("repeated tool_call with same toolCallId updates title in-place (no new bubble)", () => {
    const store = makeStore()
    fire(
      store,
      makeAcp("sess-1", { sessionUpdate: "tool_call", toolCallId: "tc1", title: "read file" }),
    )
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "tool_call",
        toolCallId: "tc1",
        title: "read file (updated)",
      }),
    )
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.toolTitle).toBe("read file (updated)")
  })

  // ── 8: tool_call_update updates toolTitle and leaves narration untouched ──
  // narration is now owned exclusively by the voice orchestrator (Gemini result);
  // ACP title updates land on toolTitle only.
  it("tool_call_update with title updates toolTitle, not narration", () => {
    const store = makeStore()
    fire(
      store,
      makeAcp("sess-1", { sessionUpdate: "tool_call", toolCallId: "tc1", title: "read file" }),
    )
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc1",
        title: "read file (executing)",
      }),
    )
    const toolSeg = store.bubbles[0]?.segments[0]
    expect(toolSeg?.toolTitle).toBe("read file (executing)")
    expect(toolSeg?.narration).toBeUndefined()
  })

  // ── 8b: updateToolNarration sets narration without touching toolTitle ─────
  it("updateToolNarration writes only to narration (orchestrator path)", () => {
    const store = makeStore()
    fire(
      store,
      makeAcp("sess-1", { sessionUpdate: "tool_call", toolCallId: "tc1", title: "read file" }),
    )
    store.updateToolNarration("tc1", "אני בודק את הקובץ README")
    const toolSeg = store.bubbles[0]?.segments[0]
    expect(toolSeg?.toolTitle).toBe("read file")
    expect(toolSeg?.narration).toBe("אני בודק את הקובץ README")
  })

  // ── 9: non-text content type → empty string appended (no crash) ───────────
  it("non-text content type in message chunk → empty string, no crash", () => {
    const store = makeStore()
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "image", url: "..." },
      }),
    )
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.text).toBe("")
  })

  // ── 10: unknown sessionUpdate type → no crash, no new bubble ─────────────
  it("unknown sessionUpdate type does not crash and creates no bubble", () => {
    const store = makeStore()
    expect(() =>
      fire(
        store,
        makeAcp("sess-1", {
          sessionUpdate: "plan",
          content: { type: "text", text: "planning..." },
        }),
      ),
    ).not.toThrow()
    expect(store.bubbles).toHaveLength(0)
  })

  // ── 11: addTranslatedSegment — Slice 10 note ─────────────────────────────
  // In Slice 10, all bubbles have messageId=null (ACP chunks don't carry messageId).
  // addTranslatedSegment matches by (kind + messageId). Passing a non-null messageId
  // is a no-op (no bubble matches). This is expected and will be addressed in a future slice.
  it("addTranslatedSegment with non-null id is no-op (bubbles have messageId=null in ACP flow)", () => {
    const store = makeStore()
    fire(
      store,
      makeAcp("sess-1", {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "The user is testing..." },
      }),
    )
    store.addTranslatedSegment("some-id", "thought", "The user is testing...", "המשתמש בודק...")
    // No match because bubble.messageId=null ≠ "some-id"
    const thoughtBubble = store.bubbles.find((b) => b.kind === "thought")
    expect(thoughtBubble?.segments).toHaveLength(1) // unchanged
  })

  it("addTranslatedSegment is a no-op when no matching bubble kind/id exists", () => {
    const store = makeStore()
    store.addTranslatedSegment("nonexistent", "thought", "orig", "translated")
    expect(store.bubbles).toHaveLength(0)
  })
})
