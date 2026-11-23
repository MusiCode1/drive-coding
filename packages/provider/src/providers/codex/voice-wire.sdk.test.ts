/**
 * voice-wire.sdk.test.ts — the wire's output must survive the ACP SDK the backend runs.
 *
 * The first version of voice-wire emitted `sessionUpdate: "state_update"` lines. They looked fine in
 * unit tests, but the SDK's client validates every notification against ACP v1 and drops that one
 * as "Invalid params" — so the reducer never saw it and a Codex session stayed "responding"
 * (measured 18/11/2026). This test feeds the real lines through the real client.
 */

import { describe, expect, it, vi } from "vitest"
import { createAttachedAcpClient } from "../../client/client.js"
import type { AcpTransport } from "../../transport/types.js"
import { createCodexVoiceWire } from "./voice-wire.js"

function clientFed(lines: string[]) {
  const enc = new TextEncoder()
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(`${l}\n`))
    },
  })
  const transport: AcpTransport = {
    readable,
    writable: new WritableStream<Uint8Array>(),
    close() {},
    onClose() {},
  }
  const onUpdate = vi.fn()
  vi.spyOn(console, "error").mockImplementation(() => {})
  createAttachedAcpClient(transport, { onUpdate })
  return onUpdate
}

const update = (u: Record<string, unknown>) =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: "s", update: u },
  })

describe("voice-wire output through the ACP SDK client", () => {
  it("control: the SDK drops a `state_update` line — the shape the first version emitted", async () => {
    const onUpdate = clientFed([update({ sessionUpdate: "state_update", state: "idle" })])
    await new Promise((r) => setTimeout(r, 50))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("the turn-end mark on a session_info_update reaches the callback with its _meta", async () => {
    const [line] = createCodexVoiceWire().fromAgent(
      update({
        sessionUpdate: "session_info_update",
        _meta: { codex: { threadStatus: { type: "idle" } } },
      }),
    )
    const onUpdate = clientFed([line as string])
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(onUpdate.mock.calls[0]?.[0].update._meta["_drive/turnState"]).toBe("idle")
  })

  it("a voice reply reaches the callback alone, with the _drive/voice mark", async () => {
    const lines = createCodexVoiceWire().fromAgent(
      update({
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "text", text: "hi" },
        _meta: { codex: { realtime: { kind: "speech", role: "assistant" } } },
      }),
    )
    expect(lines).toHaveLength(1)
    const onUpdate = clientFed(lines)
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(onUpdate.mock.calls[0]?.[0].update._meta["_drive/voice"]).toEqual({
      kind: "speech",
      role: "assistant",
    })
  })
})
