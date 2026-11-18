/**
 * voice-wire.test.ts — the codex mapping of the `_drive/voice/*` contract (slice codex-voice-poc).
 *
 * Frame shapes are the ones captured live from codex-acp (`_codex/realtime/event`,
 * `session_info_update._meta.codex.threadStatus`). The pass-through cases matter as much as the
 * mapped ones: this sits on every frame of a Codex session.
 */

import { describe, expect, it } from "vitest"
import { createCodexVoiceWire, VOICE_META_KEY } from "./voice-wire.js"

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

describe("toAgent", () => {
  it("maps _drive/voice/start to _codex/realtime/start, keeping the id", () => {
    const out = JSON.parse(
      createCodexVoiceWire().toAgent(
        rpc("_drive/voice/start", {
          sessionId: "s",
          sdp: "v=0",
          instructions: "be brief",
          voice: "maple",
        }),
      ),
    )
    expect(out).toEqual({
      jsonrpc: "2.0",
      id: 7,
      method: "_codex/realtime/start",
      params: {
        sessionId: "s",
        sdp: "v=0",
        voice: "maple",
        prompt: "be brief",
        handoffMode: "commentary",
      },
    })
  })

  it.each([
    ["_drive/voice/stop", "_codex/realtime/stop", { sessionId: "s" }],
    ["_drive/voice/speak", "_codex/realtime/appendSpeech", { sessionId: "s", text: "hi" }],
    ["_drive/voice/listVoices", "_codex/realtime/listVoices", { sessionId: "s" }],
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

describe("fromAgent — voice-conversation messages", () => {
  const chunk = (sessionUpdate: string, realtime: unknown, extraCodex: object = {}) =>
    note("session/update", {
      sessionId: "s",
      update: {
        sessionUpdate,
        messageId: "m1",
        content: { type: "text", text: "שלושה" },
        _meta: { other: 1, codex: { realtime, ...extraCodex } },
      },
    })

  it("moves codex's realtime mark to the generic _drive/voice mark, keeping everything else", () => {
    const [out] = parsed(
      createCodexVoiceWire().fromAgent(
        chunk("user_message_chunk", { kind: "speech", role: "user" }),
      ),
    )
    expect(out.params.update).toEqual({
      sessionUpdate: "user_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "שלושה" },
      _meta: { other: 1, [VOICE_META_KEY]: { kind: "speech", role: "user" } },
    })
  })

  it("keeps other codex meta keys next to the moved mark", () => {
    const [out] = parsed(
      createCodexVoiceWire().fromAgent(
        chunk("user_message_chunk", { kind: "handoff", transcript: "user: hi" }, { phase: "x" }),
      ),
    )
    expect(out.params.update._meta).toEqual({
      other: 1,
      codex: { phase: "x" },
      [VOICE_META_KEY]: { kind: "handoff", transcript: "user: hi" },
    })
  })

  it("ends the 'responding' state a voice reply causes, unless Codex is still working", () => {
    const wire = createCodexVoiceWire()
    const speech = chunk("agent_message_chunk", { kind: "speech", role: "assistant" })
    expect(parsed(wire.fromAgent(speech)).at(-1).params.update).toEqual({
      sessionUpdate: "state_update",
      state: "idle",
    })
    wire.fromAgent(info("s", "active"))
    expect(wire.fromAgent(speech)).toHaveLength(1)
  })

  it.each([
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
    [
      "a codex ext notification",
      note("_codex/realtime/event", { sessionId: "s", method: "thread/realtime/started" }),
    ],
    ["a non-JSON line", "threadStatus garbage"],
  ])("passes %s through alone", (_name, line) => {
    expect(createCodexVoiceWire().fromAgent(line)).toEqual([line])
  })
})

describe("listVoices answer", () => {
  it("adds catalog details to the answer of a _drive/voice/listVoices request only", () => {
    const wire = createCodexVoiceWire()
    wire.toAgent(rpc("_drive/voice/listVoices", { sessionId: "s" }, 41))
    const answer = JSON.stringify({
      jsonrpc: "2.0",
      id: 41,
      result: { voices: ["cove", "porto"], default: "cove" },
    })
    const [out] = parsed(wire.fromAgent(answer))
    expect(out.result.voices).toEqual(["cove", "porto"])
    expect(out.result.details.cove).toMatchObject({
      accent: "American English",
      description: "Composed and direct",
    })
    expect(out.result.details.cove.previewUrl).toMatch(/cove\.en\..+\.m4a$/)
    expect(out.result.details).not.toHaveProperty("porto")
    // an unrelated answer with another id passes untouched
    const other = JSON.stringify({ jsonrpc: "2.0", id: 42, result: { voices: ["cove"] } })
    expect(wire.fromAgent(other)).toEqual([other])
  })
})
