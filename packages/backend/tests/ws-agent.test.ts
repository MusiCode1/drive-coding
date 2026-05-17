/**
 * ws-agent.test.ts — Slice 9 tests (old server-side ACP session model).
 *
 * NOTE: These tests are skipped because ws-agent.ts was refactored in
 * Slice 10 Phase 1 into a transparent bytes pipe. The old API
 * (getSession, subscribe, sendPrompt, sendAudioPrompt, etc.) no longer exists.
 *
 * New tests for the bytes-pipe model are in ws-agent-pipe.test.ts.
 *
 * These tests will be DELETED in Slice 10 Phase 4 along with agent-session.ts.
 */

import { describe, it } from "vitest"

// removed in slice 10 phase 4
describe.skip("createAgentWsHandler (Slice 9 — removed in Slice 10 Phase 4)", () => {
  it("old: known agent → sends connected message + subscribes", () => {
    // This behaviour is replaced by bytes-pipe in Slice 10.
    // See ws-agent-pipe.test.ts for new tests.
  })

  it("old: unknown agent → sends error + closes", () => {})
  it("old: invalid JSON → sends INVALID_JSON error", () => {})
  it("old: unknown message type → sends INVALID_MSG error", () => {})
  it("old: ping → pong with serverTime", () => {})
  it("old: prompt → calls session.sendPrompt with text", () => {})
  it("old: cancel → calls session.cancel", () => {})
  it("old: audio → decodes base64 + calls session.sendAudioPrompt", () => {})
  it("old: DUP-1 voiceCallbacks.onAudioChunk MUST NOT send audio_chunk frame", () => {})
  it("old: agent removed mid-session → AGENT_NOT_FOUND", () => {})
  it("old: session broadcasts → forwarded to ws.send", () => {})
  it("old: close() → unsubscribes the session subscriber", () => {})
  it("old: tryUpgrade URL matching", () => {})
  it("old: tryUpgrade URL not matching", () => {})
  it("old: tryUpgrade upgrade returns false → 426", () => {})
})
