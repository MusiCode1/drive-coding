/**
 * agent-session-bubbles.test.ts — Phase 2 TDD (updated for ACP-based store)
 *
 * Tests for the `bubbles` state and grouping logic in agent-session store.
 * Uses _testInjectNotification() to bypass ACP handshake in tests.
 *
 * Bubble grouping rules:
 *   - Same kind + same messageId (or both null) → append segment to last bubble
 *   - Kind change or different messageId → new bubble
 *   - tool_call → tool bubble (merged by toolCallId)
 *   - tool_call_update → narration update on existing tool bubble
 *   - stt_partial → streaming user bubble (single, updated in-place)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAgentSessionStore } from "./agent-session.svelte"

// SKIP: These tests use the Slice 9 server-protocol shape ({ type, text, messageId }).
// Slice 10 Phase 3 switched to ACP envelope shape ({ sessionId, update: { sessionUpdate, content } }).
// Per-messageId grouping no longer applies (ACP chunks don't carry messageId at this level).
// Will be rewritten in Phase 4 cleanup with the new shape + new grouping rules.
describe.skip("agent-session bubble grouping (Phase 2 — Slice 9 shape, deprecated)", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("uuid") })
    vi.stubGlobal("location", { protocol: "http:", host: "localhost" })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function makeStore() {
    const store = createAgentSessionStore("a")
    // Override status to "connected" so sendPrompt works
    return store
  }

  function fire(store: ReturnType<typeof makeStore>, msg: unknown) {
    // biome-ignore lint/style/noNonNullAssertion: test-only helper always present on real store
    store._testInjectNotification!(msg)
  }

  // ── 1: first text_chunk creates a message bubble ───────────────────────────
  it("first agent_message_chunk creates a message bubble with one segment", () => {
    const store = makeStore()
    fire(store, { type: "agent_message_chunk", text: "שלום", messageId: "m1" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.kind).toBe("message")
    expect(store.bubbles[0]?.segments).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.text).toBe("שלום")
  })

  // ── 2: consecutive same-kind, no messageId → text concatenated in same segment ──
  it("consecutive same-kind chunks (no messageId) → text concatenated in one segment (B1)", () => {
    const store = makeStore()
    fire(store, { type: "agent_message_chunk", text: "A", messageId: null })
    fire(store, { type: "agent_message_chunk", text: "B", messageId: null })
    fire(store, { type: "agent_message_chunk", text: "C", messageId: null })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.segments).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.text).toBe("ABC")
  })

  // ── B1 TDD: 3 chunks with same messageId → 1 segment with full text ─────────
  it("B1: 3 chunks with same messageId form 1 segment with concatenated text", () => {
    const store = makeStore()
    fire(store, { type: "agent_message_chunk", text: "שלום, ", messageId: "m1" })
    fire(store, { type: "agent_message_chunk", text: "אני שומע ", messageId: "m1" })
    fire(store, { type: "agent_message_chunk", text: "אותך.", messageId: "m1" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.segments).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.text).toBe("שלום, אני שומע אותך.")
  })

  // ── 3: kind change → new bubble ────────────────────────────────────────────
  it("kind change (thought → message) creates a new bubble", () => {
    const store = makeStore()
    fire(store, { type: "agent_thought_chunk", text: "thinking", messageId: "t1" })
    fire(store, { type: "agent_message_chunk", text: "answer", messageId: "m1" })
    expect(store.bubbles).toHaveLength(2)
    expect(store.bubbles[0]?.kind).toBe("thought")
    expect(store.bubbles[1]?.kind).toBe("message")
  })

  // ── 4: different messageId same kind → new bubble ──────────────────────────
  it("different messageId for same kind creates a new bubble", () => {
    const store = makeStore()
    fire(store, { type: "agent_message_chunk", text: "first", messageId: "m1" })
    fire(store, { type: "agent_message_chunk", text: "second", messageId: "m2" })
    expect(store.bubbles).toHaveLength(2)
    expect(store.bubbles[0]?.segments[0]?.text).toBe("first")
    expect(store.bubbles[1]?.segments[0]?.text).toBe("second")
  })

  // ── 5: same messageId same kind → text concatenated into one segment ─────────
  it("same messageId and same kind concatenates text into one segment (B1)", () => {
    const store = makeStore()
    fire(store, { type: "agent_message_chunk", text: "part1", messageId: "m1" })
    fire(store, { type: "agent_message_chunk", text: "part2", messageId: "m1" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.segments).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.text).toBe("part1part2")
  })

  // ── 6: thought kind groups correctly with messageId ─────────────────────────
  it("thought kind chunks with same messageId → text concatenated in same thought bubble", () => {
    const store = makeStore()
    fire(store, { type: "agent_thought_chunk", text: "segment A", messageId: "t1" })
    fire(store, { type: "agent_thought_chunk", text: "segment B", messageId: "t1" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.kind).toBe("thought")
    expect(store.bubbles[0]?.segments).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.text).toBe("segment Asegment B")
  })

  // ── 7: chronological order: thought → tool → thought → message = 4 bubbles ─
  it("chronological: thought → tool → thought → message = 4 distinct bubbles", () => {
    const store = makeStore()
    fire(store, { type: "agent_thought_chunk", text: "first", messageId: "th1" })
    fire(store, { type: "tool_call", toolCallId: "tc1", title: "read file" })
    fire(store, { type: "agent_thought_chunk", text: "second", messageId: "th2" })
    fire(store, { type: "agent_message_chunk", text: "answer", messageId: "m1" })
    expect(store.bubbles).toHaveLength(4)
    expect(store.bubbles[0]?.kind).toBe("thought")
    expect(store.bubbles[1]?.kind).toBe("tool")
    expect(store.bubbles[2]?.kind).toBe("thought")
    expect(store.bubbles[3]?.kind).toBe("message")
  })

  // ── 8: tool_call creates tool bubble with toolCallId + title ────────────────
  it("tool_call creates a tool bubble with toolCallId and title in segment", () => {
    const store = makeStore()
    fire(store, { type: "tool_call", toolCallId: "tc1", title: "read file" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.kind).toBe("tool")
    expect(store.bubbles[0]?.segments[0]?.toolCallId).toBe("tc1")
    expect(store.bubbles[0]?.segments[0]?.toolTitle).toBe("read file")
  })

  // ── 9: tool_call_update adds narration to existing tool bubble ─────────────
  it("tool_call_update adds narration to existing tool bubble", () => {
    const store = makeStore()
    fire(store, { type: "tool_call", toolCallId: "tc1", title: "read file" })
    fire(store, { type: "tool_call_update", toolCallId: "tc1", narration: "checking..." })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.narration).toBe("checking...")
  })

  // ── 10: stt_partial creates user bubble ────────────────────────────────────
  it("stt_partial creates a user bubble", () => {
    const store = makeStore()
    fire(store, { type: "stt_partial", text: "שלום" })
    const userBubble = store.bubbles.find((b) => b.kind === "user")
    expect(userBubble).toBeDefined()
    expect(userBubble?.segments[0]?.text).toBe("שלום")
  })

  // ── 11: consecutive stt_partial → update same user bubble (streaming) ──────
  it("consecutive stt_partial events update same user bubble in place", () => {
    const store = makeStore()
    fire(store, { type: "stt_partial", text: "שלו" })
    fire(store, { type: "stt_partial", text: "שלום, אני בודקת" })
    const userBubbles = store.bubbles.filter((b) => b.kind === "user")
    expect(userBubbles).toHaveLength(1)
    expect(userBubbles[0]?.segments[0]?.text).toBe("שלום, אני בודקת")
  })

  // ── B10: addTranslatedSegment adds translated segment to matching bubble ────
  it("B10: addTranslatedSegment adds segment with text=Hebrew + originalText=English", () => {
    const store = makeStore()
    fire(store, {
      type: "agent_thought_chunk",
      text: "The user is testing...",
      messageId: "m1",
    })
    store.addTranslatedSegment("m1", "thought", "The user is testing...", "המשתמש בודק...")
    const thoughtBubble = store.bubbles.find((b) => b.kind === "thought")
    expect(thoughtBubble?.segments).toHaveLength(2)
    const translated = thoughtBubble?.segments[1]
    expect(translated?.text).toBe("המשתמש בודק...")
    expect(translated?.originalText).toBe("The user is testing...")
  })

  it("B10: addTranslatedSegment is a no-op when no matching bubble exists", () => {
    const store = makeStore()
    store.addTranslatedSegment("nonexistent", "thought", "orig", "translated")
    expect(store.bubbles).toHaveLength(0)
  })

  it("B10: addTranslatedSegment targets correct bubble by messageId when multiple bubbles exist", () => {
    const store = makeStore()
    fire(store, { type: "agent_thought_chunk", text: "first thought", messageId: "m1" })
    fire(store, { type: "agent_thought_chunk", text: "second thought", messageId: "m2" })
    store.addTranslatedSegment("m2", "thought", "second thought", "מחשבה שנייה")
    expect(store.bubbles).toHaveLength(2)
    expect(store.bubbles[0]?.segments).toHaveLength(1)
    expect(store.bubbles[1]?.segments).toHaveLength(2)
    expect(store.bubbles[1]?.segments[1]?.text).toBe("מחשבה שנייה")
  })
})
