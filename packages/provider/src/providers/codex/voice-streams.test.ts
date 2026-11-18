/**
 * voice-streams.test.ts — line framing around the codex voice mapping (slice codex-voice-poc).
 */

import { describe, expect, it } from "vitest"
import { createCodexVoiceStreams } from "./voice-streams.js"

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let out = ""
    stream.on("data", (c: Buffer) => {
      out += c.toString("utf8")
    })
    stream.on("end", () => resolve(out))
  })
}

describe("createCodexVoiceStreams", () => {
  it("maps whole lines even when a frame arrives split across chunks", async () => {
    const { toAgent } = createCodexVoiceStreams()
    const done = collect(toAgent)
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "_drive/voice/stop",
      params: { sessionId: "s" },
    })
    toAgent.write(line.slice(0, 20))
    toAgent.write(`${line.slice(20)}\n`)
    toAgent.end()
    expect(JSON.parse((await done).trim()).method).toBe("_codex/realtime/stop")
  })

  it("passes unrelated frames through byte-for-byte, and rewrites marked ones", async () => {
    const { fromAgent } = createCodexVoiceStreams()
    const done = collect(fromAgent)
    const plain = JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} })
    const speech = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "hi" },
          _meta: { codex: { realtime: { kind: "speech", role: "user" } } },
        },
      },
    })
    fromAgent.end(`${plain}\n${speech}`) // last line without a newline is flushed on end
    const lines = (await done).trim().split("\n")
    expect(lines[0]).toBe(plain)
    expect(JSON.parse(lines[1] ?? "").params.update._meta).toEqual({
      "_drive/voice": { kind: "speech", role: "user" },
    })
  })
})
