/**
 * reduce-voice-turnstate.test.ts — voice-conversation messages do not move the turn state, and a
 * `session_info_update` carrying `_meta["_drive/turnState"]: "idle"` ends the turn.
 *
 * Measured 18/11/2026: a Codex session whose voice replies were replayed after a session/load
 * stayed "responding" for good. Its idle signal was a `state_update` line, which the backend's ACP
 * SDK drops before the reducer (provider voice-wire.sdk.test.ts pins that).
 */

import { describe, expect, it } from "vitest"
import { reduce } from "./reduce"
import { createInitialSessionState, type SessionState } from "./types"

const idle = (o: Partial<SessionState> = {}): SessionState => ({
  ...createInitialSessionState({ sessionId: null }),
  turnState: "idle",
  ...o,
})
const voice = { "_drive/voice": { kind: "speech", role: "assistant" } }
const chunk = (sessionUpdate: string, _meta?: object) => ({
  sessionUpdate,
  messageId: "m1",
  content: { type: "text", text: "hi" },
  ...(_meta ? { _meta } : {}),
})

describe("voice-conversation messages keep the turn state", () => {
  it("control: an ordinary agent chunk makes an idle session 'responding'", () => {
    expect(reduce(idle(), chunk("agent_message_chunk")).state.turnState).toBe("responding")
  })

  it("a voice agent chunk leaves an idle session idle — and is still added", () => {
    const { state } = reduce(idle(), chunk("agent_message_chunk", voice))
    expect(state.turnState).toBe("idle")
    expect(state.messages).toHaveLength(1)
  })

  it("a voice message does not end a turn that is running either", () => {
    const { state } = reduce(
      idle({ turnState: "calling-tool" }),
      chunk("agent_message_chunk", voice),
    )
    expect(state.turnState).toBe("calling-tool")
  })

  it("a whole voice agent_message leaves an idle session idle", () => {
    const { state } = reduce(idle(), chunk("agent_message", voice))
    expect(state.turnState).toBe("idle")
    expect(state.messages).toHaveLength(1)
  })
})

describe("session_info_update with the turn-end mark", () => {
  const info = (extra: object = {}) => ({
    sessionUpdate: "session_info_update",
    _meta: { "_drive/turnState": "idle" },
    ...extra,
  })

  it("ends a 'responding' turn, with a patch the clients apply", () => {
    const { state, patches } = reduce(idle({ turnState: "responding" }), info())
    expect(state.turnState).toBe("idle")
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({ op: "update-session", changes: { turnState: "idle" } })
  })

  it("carries a title in the same update", () => {
    const { state, patches } = reduce(idle({ turnState: "responding" }), info({ title: "T" }))
    expect(state).toMatchObject({ turnState: "idle", title: "T" })
    expect(patches[0]).toMatchObject({ changes: { turnState: "idle", title: "T" } })
  })

  it("changes nothing on an idle session with no title (the _meta is still carried opaquely)", () => {
    const { state, patches } = reduce(idle(), info())
    expect(state.turnState).toBe("idle")
    expect(patches.some((p) => p.op === "update-session")).toBe(false)
  })

  it("control: without the mark a session_info_update leaves the turn alone", () => {
    const { state } = reduce(idle({ turnState: "responding" }), {
      sessionUpdate: "session_info_update",
      title: "T",
    })
    expect(state.turnState).toBe("responding")
    expect(state.title).toBe("T")
  })
})
