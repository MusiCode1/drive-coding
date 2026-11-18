/**
 * voice-wire.test.ts — the codex mapping of the `_drive/voice/*` contract (slice codex-voice-poc).
 *
 * Frame shapes are the ones captured live from codex-acp (`_codex/realtime/event`,
 * `session_info_update._meta.codex.threadStatus`). The pass-through cases matter as much as the
 * mapped ones: this sits on every frame of a Codex session.
 */

import { describe, expect, it } from "vitest"
import { createCodexVoiceWire, VOICE_MESSAGE_PREFIX } from "./voice-wire.js"

const rpc = (method: string, params: unknown, id = 7) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params })
const note = (method: string, params: unknown) => JSON.stringify({ jsonrpc: "2.0", method, params })
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l))
const info = (sessionId: string, status: string) =>
  note("session/update", {
    sessionId,
    update: {
      sessionUpdate: "session_info_update",
      _meta: { codex: { threadStatus: { type: status } } },
    },
  })
const transcript = (sessionId: string, role: string, text: string) =>
  note("_codex/realtime/event", {
    sessionId,
    method: "thread/realtime/transcript/done",
    params: { threadId: sessionId, role, text },
  })

describe("toAgent", () => {
  it("maps _drive/voice/start to _codex/realtime/start, keeping the id", () => {
    const out = JSON.parse(
      createCodexVoiceWire().toAgent(
        rpc("_drive/voice/start", { sessionId: "s", sdp: "v=0", instructions: "be brief" }),
      ),
    )
    expect(out).toEqual({
      jsonrpc: "2.0",
      id: 7,
      method: "_codex/realtime/start",
      params: { sessionId: "s", sdp: "v=0", prompt: "be brief", handoffMode: "commentary" },
    })
  })

  it.each([
    ["_drive/voice/stop", "_codex/realtime/stop", { sessionId: "s" }],
    ["_drive/voice/speak", "_codex/realtime/appendSpeech", { sessionId: "s", text: "hi" }],
  ])("maps %s to %s with params unchanged", (from, to, params) => {
    expect(JSON.parse(createCodexVoiceWire().toAgent(rpc(from, params)))).toMatchObject({
      method: to,
      params,
    })
  })

  it.each([
    ["an ordinary prompt", rpc("session/prompt", { sessionId: "s", prompt: [] })],
    ["another _drive ext method", rpc("_drive/getQuota", { sessionId: "s" })],
    ["a non-JSON line", "not json _drive/voice/start"],
  ])("leaves %s untouched", (_name, line) => {
    expect(createCodexVoiceWire().toAgent(line)).toBe(line)
  })
})

describe("fromAgent — thread status", () => {
  it("mirrors a status change as a generic state_update, once per change", () => {
    const wire = createCodexVoiceWire()
    const active = wire.fromAgent(info("s", "active"))
    expect(parsed(active)[1]).toEqual({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "s", update: { sessionUpdate: "state_update", state: "running" } },
    })
    expect(wire.fromAgent(info("s", "active"))).toHaveLength(1) // no change → nothing added
    expect(parsed(wire.fromAgent(info("s", "idle")))[1].params.update.state).toBe("idle")
  })
})

describe("fromAgent — voice transcripts", () => {
  it("turns a final transcript into a voice-marked chat message, per role", () => {
    const wire = createCodexVoiceWire()
    const [, user] = parsed(wire.fromAgent(transcript("s", "user", " כמה קבצים? ")))
    expect(user.params.update).toMatchObject({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: `${VOICE_MESSAGE_PREFIX}כמה קבצים?` },
    })
    const [, assistant] = parsed(wire.fromAgent(transcript("s", "assistant", "שלושה")))
    expect(assistant.params.update.sessionUpdate).toBe("agent_message_chunk")
    expect(assistant.params.update.messageId).not.toBe(user.params.update.messageId)
  })

  it("ends the 'responding' state the voice message causes, unless Codex is still working", () => {
    const wire = createCodexVoiceWire()
    expect(parsed(wire.fromAgent(transcript("s", "assistant", "hi"))).at(-1).params.update).toEqual(
      {
        sessionUpdate: "state_update",
        state: "idle",
      },
    )
    wire.fromAgent(info("s", "active"))
    expect(wire.fromAgent(transcript("s", "assistant", "checking"))).toHaveLength(2)
  })

  it.each([
    ["an empty transcript", transcript("s", "assistant", "  ")],
    ["an unknown role", transcript("s", "system", "x")],
    [
      "another realtime event",
      note("_codex/realtime/event", {
        sessionId: "s",
        method: "thread/realtime/started",
        params: {},
      }),
    ],
    [
      "an ordinary agent chunk",
      note("session/update", { sessionId: "s", update: { sessionUpdate: "agent_message_chunk" } }),
    ],
    [
      "a session_info_update without thread status",
      note("session/update", {
        sessionId: "s",
        update: { sessionUpdate: "session_info_update", title: "x" },
      }),
    ],
    ["a non-JSON line", "threadStatus garbage"],
  ])("passes %s through alone", (_name, line) => {
    expect(createCodexVoiceWire().fromAgent(line)).toEqual([line])
  })
})
