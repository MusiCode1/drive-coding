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

  it("passes unrelated frames through byte-for-byte, and expands mapped ones", async () => {
    const { fromAgent } = createCodexVoiceStreams()
    const done = collect(fromAgent)
    const plain = JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} })
    const transcript = JSON.stringify({
      jsonrpc: "2.0",
      method: "_codex/realtime/event",
      params: {
        sessionId: "s",
        method: "thread/realtime/transcript/done",
        params: { role: "user", text: "hi" },
      },
    })
    fromAgent.end(`${plain}\n${transcript}`) // last line without a newline is flushed on end
    const lines = (await done).trim().split("\n")
    expect(lines[0]).toBe(plain)
    expect(lines[1]).toBe(transcript)
    expect(lines.slice(2).map((l) => JSON.parse(l).params.update.sessionUpdate)).toEqual([
      "user_message_chunk",
      "state_update",
    ])
  })
})
