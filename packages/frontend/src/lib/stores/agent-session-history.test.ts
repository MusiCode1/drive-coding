/**
 * agent-session-history.test.ts — Phase 6 TDD
 *
 * Tests for Slice 8a history events in agent-session store:
 *   - history_start: clears bubbles, sets isLoadingHistory=true
 *   - history_chunk: appends bubbles as historical
 *   - history_tool_call: appends tool bubble as historical
 *   - history_done: sets isLoadingHistory=false
 *   - audio_recording_saved: stores recordingId associated with last user message
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLastWs, installWebSocketMock } from "./__test-helpers__"
import { createAgentSessionStore } from "./agent-session.svelte"

describe("agent-session history events (Phase 6)", () => {
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

  // ── 1: history_start clears existing bubbles ────────────────────────────
  it("history_start clears existing bubbles and sets isLoadingHistory=true", async () => {
    const { store, ws } = await makeConnected()
    // Add some live bubbles first
    fire(ws, { type: "text_chunk", kind: "message", text: "existing" })
    expect(store.bubbles).toHaveLength(1)

    // Now history_start arrives
    fire(ws, { type: "history_start", agentId: "a", sessionId: "sess-1" })
    expect(store.bubbles).toHaveLength(0)
    expect(store.isLoadingHistory).toBe(true)
  })

  // ── 2: history_chunk pushes historical bubble ───────────────────────────
  it("history_chunk creates bubbles marked as historical", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "history_start", agentId: "a", sessionId: "sess-1" })
    fire(ws, { type: "history_chunk", kind: "message", text: "old message", messageId: "m1" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.kind).toBe("message")
    expect(store.bubbles[0]?.segments[0]?.historical).toBe(true)
  })

  // ── 3: history_chunk groups by messageId ───────────────────────────────
  it("history_chunks with same messageId group into same bubble", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "history_start", agentId: "a", sessionId: "sess-1" })
    fire(ws, { type: "history_chunk", kind: "message", text: "part1", messageId: "m1" })
    fire(ws, { type: "history_chunk", kind: "message", text: "part2", messageId: "m1" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.segments).toHaveLength(2)
  })

  // ── 4: history_tool_call creates historical tool bubble ─────────────────
  it("history_tool_call creates a historical tool bubble", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "history_start", agentId: "a", sessionId: "sess-1" })
    fire(ws, { type: "history_tool_call", toolCallId: "tc1", title: "read file" })
    expect(store.bubbles).toHaveLength(1)
    expect(store.bubbles[0]?.kind).toBe("tool")
    expect(store.bubbles[0]?.segments[0]?.historical).toBe(true)
  })

  // ── 5: history_done clears isLoadingHistory ─────────────────────────────
  it("history_done sets isLoadingHistory=false", async () => {
    const { store, ws } = await makeConnected()
    fire(ws, { type: "history_start", agentId: "a", sessionId: "sess-1" })
    expect(store.isLoadingHistory).toBe(true)
    fire(ws, { type: "history_done" })
    expect(store.isLoadingHistory).toBe(false)
  })

  // ── 6: audio_recording_saved stores recordingId ─────────────────────────
  it("audio_recording_saved stores recordingId for last user message", async () => {
    const { store, ws } = await makeConnected()
    // Create a user bubble via stt_partial
    fire(ws, { type: "stt_partial", text: "שלום" })
    // Then audio_recording_saved arrives (before done)
    fire(ws, { type: "audio_recording_saved", recordingId: "rec-1", mimeType: "audio/mp3" })
    // The recording should be associated
    expect(store.getRecordingId()).toBe("rec-1")
  })
})
