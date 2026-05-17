/**
 * agent-session-bubbles.test.ts — Phase 2 TDD
 *
 * Tests for the new `bubbles` state and grouping logic in agent-session store.
 * Bubble grouping rules:
 *   - Same kind + same messageId (or both null) → append segment to last bubble
 *   - Kind change or different messageId → new bubble
 *   - tool_call → tool bubble (merged by toolCallId)
 *   - tool_call_update → narration update on existing tool bubble
 *   - stt_partial → streaming user bubble (single, updated in-place)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLastWs, installWebSocketMock } from "./__test-helpers__"
import { createAgentSessionStore } from "./agent-session.svelte"

describe("agent-session bubble grouping (Phase 2)", () => {
  beforeEach(() => {
    installWebSocketMock()
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("uuid") })
    vi.stubGlobal("location", { protocol: "http:", host: "localhost" })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function makeConnected() {
    const store = createAgentSessionStore("a")
    store.connect()
    await new Promise<void>((r) => queueMicrotask(r))
    const ws = getLastWs()
    return { store, ws }
  }

  function fire(ws: ReturnType<typeof getLastWs>, msg: unknown) {
    ws.onmessage?.({ data: JSON.stringify(msg) })
  }

  // ── 1: first text_chunk creates a message bubble ───────────────────────────
  it("first text_chunk creates a message bubble with one segment", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "text_chunk", kind: "message", text: "שלום" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.kind).toBe("message")
    expect(store.bubbles[0]?.segments).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.text).toBe("שלום")
  })

  // ── 2: consecutive same-kind, no messageId → segments in same bubble ────────
  it("consecutive same-kind chunks (no messageId) → segments in same bubble", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "text_chunk", kind: "message", text: "A" })
    fire(ws, { type: "text_chunk", kind: "message", text: "B" })
    fire(ws, { type: "text_chunk", kind: "message", text: "C" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.segments).toHaveLength(3)
    expect(store.bubbles[0]?.segments[2]?.text).toBe("C")
  })

  // ── 3: kind change → new bubble ────────────────────────────────────────────
  it("kind change (thought → message) creates a new bubble", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "text_chunk", kind: "thought", text: "thinking" })
    fire(ws, { type: "text_chunk", kind: "message", text: "answer" })
    expect(store.bubbles).toHaveLength(2)
    expect(store.bubbles[0]?.kind).toBe("thought")
    expect(store.bubbles[1]?.kind).toBe("message")
  })

  // ── 4: different messageId same kind → new bubble ──────────────────────────
  it("different messageId for same kind creates a new bubble", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "text_chunk", kind: "message", text: "first", messageId: "m1" })
    fire(ws, { type: "text_chunk", kind: "message", text: "second", messageId: "m2" })
    expect(store.bubbles).toHaveLength(2)
    expect(store.bubbles[0]?.segments[0]?.text).toBe("first")
    expect(store.bubbles[1]?.segments[0]?.text).toBe("second")
  })

  // ── 5: same messageId same kind → same bubble ──────────────────────────────
  it("same messageId and same kind appends to same bubble", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "text_chunk", kind: "message", text: "part1", messageId: "m1" })
    fire(ws, { type: "text_chunk", kind: "message", text: "part2", messageId: "m1" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.segments).toHaveLength(2)
    expect(store.bubbles[0]?.segments[1]?.text).toBe("part2")
  })

  // ── 6: thought kind groups correctly with messageId ─────────────────────────
  it("thought kind chunks with same messageId → segments in same thought bubble", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "text_chunk", kind: "thought", text: "segment A", messageId: "t1" })
    fire(ws, { type: "text_chunk", kind: "thought", text: "segment B", messageId: "t1" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.kind).toBe("thought")
    expect(store.bubbles[0]?.segments).toHaveLength(2)
  })

  // ── 7: chronological order: thought → tool → thought → message = 4 bubbles ─
  it("chronological: thought → tool → thought → message = 4 distinct bubbles", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "text_chunk", kind: "thought", text: "first", messageId: "th1" })
    fire(ws, { type: "tool_call", toolCallId: "tc1", title: "read file" })
    fire(ws, { type: "text_chunk", kind: "thought", text: "second", messageId: "th2" })
    fire(ws, { type: "text_chunk", kind: "message", text: "answer" })
    expect(store.bubbles).toHaveLength(4)
    expect(store.bubbles[0]?.kind).toBe("thought")
    expect(store.bubbles[1]?.kind).toBe("tool")
    expect(store.bubbles[2]?.kind).toBe("thought")
    expect(store.bubbles[3]?.kind).toBe("message")
  })

  // ── 8: tool_call creates tool bubble with toolCallId + title ────────────────
  it("tool_call creates a tool bubble with toolCallId and title in segment", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "tool_call", toolCallId: "tc1", title: "read file" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.kind).toBe("tool")
    expect(store.bubbles[0]?.segments[0]?.toolCallId).toBe("tc1")
    expect(store.bubbles[0]?.segments[0]?.toolTitle).toBe("read file")
  })

  // ── 9: tool_call_update adds narration to existing tool bubble ─────────────
  it("tool_call_update adds narration to existing tool bubble", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "tool_call", toolCallId: "tc1", title: "read file" })
    fire(ws, { type: "tool_call_update", toolCallId: "tc1", narration: "checking..." })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.segments[0]?.narration).toBe("checking...")
  })

  // ── 10: stt_partial creates user bubble ────────────────────────────────────
  it("stt_partial creates a user bubble", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "stt_partial", text: "שלום" })
    const userBubble = store.bubbles.find((b) => b.kind === "user")
    expect(userBubble).toBeDefined()
    expect(userBubble?.segments[0]?.text).toBe("שלום")
  })

  // ── 11: consecutive stt_partial → update same user bubble (streaming) ──────
  it("consecutive stt_partial events update same user bubble in place", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "stt_partial", text: "שלו" })
    fire(ws, { type: "stt_partial", text: "שלום, אני בודקת" })
    const userBubbles = store.bubbles.filter((b) => b.kind === "user")
    expect(userBubbles).toHaveLength(1)
    expect(userBubbles[0]?.segments[0]?.text).toBe("שלום, אני בודקת")
  })
})
