/**
 * stream-bridge.test.ts — unit tests for createStreamBridge (CUT-3b-iii-1, Phase 0).
 *
 * Tests the Stream↔wire adapter:
 *   - wireEnd.write(line) → agentEnd.readable reads AnyMessage (FE→agent direction)
 *   - agentEnd.writable writes AnyMessage → wireEnd.onLine(cb) receives JSON string (agent→FE direction)
 *   - write() returns false when closed
 *   - multiple subscribers on onLine all receive messages
 *   - malformed JSON in write() is dropped (returns false)
 *   - unsubscribe from onLine works
 */

import type { AnyMessage } from "@agentclientprotocol/sdk"
import { describe, expect, it, vi } from "vitest"
import { createStreamBridge } from "./stream-bridge.js"

/** Read one message from a ReadableStream<AnyMessage> */
async function readOne(readable: ReadableStream<AnyMessage>): Promise<AnyMessage> {
  const reader = readable.getReader()
  try {
    const { value, done } = await reader.read()
    if (done) throw new Error("stream ended before a message")
    return value
  } finally {
    reader.releaseLock()
  }
}

/** Write one AnyMessage to a WritableStream<AnyMessage> */
async function writeOne(writable: WritableStream<AnyMessage>, msg: AnyMessage): Promise<void> {
  const writer = writable.getWriter()
  try {
    await writer.write(msg)
  } finally {
    writer.releaseLock()
  }
}

/** Small helper: wait one microtask tick */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("createStreamBridge — Stream↔wire adapter", () => {
  it("wireEnd.write(line) → agentEnd.readable receives parsed AnyMessage (FE→agent)", async () => {
    const bridge = createStreamBridge()
    const msg: AnyMessage = {
      jsonrpc: "2.0",
      id: 42,
      method: "initialize",
      params: { protocolVersion: 1 },
    }

    // Start reading from agentEnd.readable BEFORE writing
    const readPromise = readOne(bridge.agentEnd.readable)

    // Write the JSON string via wireEnd
    const line = JSON.stringify(msg)
    const ok = bridge.wireEnd.write(line)
    expect(ok).toBe(true)

    const received = await readPromise
    expect(received).toEqual(msg)
  })

  it("agentEnd.writable write → wireEnd.onLine receives JSON string (agent→FE)", async () => {
    const bridge = createStreamBridge()
    const msg: AnyMessage = {
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "hello" } } },
    }

    const received: string[] = []
    bridge.wireEnd.onLine((line) => received.push(line))

    // Write from agent side
    await writeOne(bridge.agentEnd.writable, msg)

    // Wait for the drain loop to process
    await tick()
    await tick()

    expect(received).toHaveLength(1)
    expect(JSON.parse(received[0]!)).toEqual(msg)
  })

  it("multiple onLine subscribers all receive the message", async () => {
    const bridge = createStreamBridge()
    const msg: AnyMessage = {
      jsonrpc: "2.0",
      method: "$/cancel_request",
      params: { id: 1 },
    }

    const cb1 = vi.fn()
    const cb2 = vi.fn()
    bridge.wireEnd.onLine(cb1)
    bridge.wireEnd.onLine(cb2)

    await writeOne(bridge.agentEnd.writable, msg)
    await tick()
    await tick()

    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
    expect(JSON.parse(cb1.mock.calls[0]![0])).toEqual(msg)
    expect(JSON.parse(cb2.mock.calls[0]![0])).toEqual(msg)
  })

  it("onLine unsubscribe stops receiving further messages", async () => {
    const bridge = createStreamBridge()

    const received: string[] = []
    const unsub = bridge.wireEnd.onLine((line) => received.push(line))

    const msg1: AnyMessage = { jsonrpc: "2.0", method: "initialize", id: 1 }
    const msg2: AnyMessage = { jsonrpc: "2.0", method: "authenticate", id: 2 }

    await writeOne(bridge.agentEnd.writable, msg1)
    await tick()
    await tick()

    unsub()

    await writeOne(bridge.agentEnd.writable, msg2)
    await tick()
    await tick()

    expect(received).toHaveLength(1)
    expect(JSON.parse(received[0]!)).toEqual(msg1)
  })

  it("malformed JSON in wireEnd.write() returns false and does not crash", () => {
    const bridge = createStreamBridge()
    const result = bridge.wireEnd.write("not-valid-json{{{")
    expect(result).toBe(false)
  })

  it("wireEnd.write() returns false after close()", () => {
    const bridge = createStreamBridge()
    bridge.close()
    const result = bridge.wireEnd.write(JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }))
    expect(result).toBe(false)
  })

  it("write rejection is absorbed and does NOT close the bridge (session survives)", async () => {
    // TDD: vitest fails automatically on unhandledRejection that escapes.
    // Before the fix (C3): write rejection set closed=true + fired onErrorFire → crashListeners → session teardown.
    // After revert: rejection is absorbed via log.warn only — no teardown, no closed from rejection.
    const bridge = createStreamBridge()

    // Force the inbound stream into an errored state (agent side cancelled):
    const r = bridge.agentEnd.readable.getReader()
    await r.cancel(new Error("agent gone"))
    r.releaseLock()

    // The first write opens a writer on the errored inbound stream → write rejects.
    // Must be absorbed (no unhandledRejection) — and the bridge must NOT set closed from the rejection.
    bridge.wireEnd.write(JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }))

    // Wait for the async .catch to fire (two microtask ticks).
    await tick()
    await tick()

    // The WritableStream itself may be errored, but closed was NOT set by the rejection.
    // Verify: a subsequent write that would fail only due to closed=true (not stream error) still
    // reaches the stream path (write returns true — not false from the closed guard).
    // Note: the underlying WritableStream may still reject (it's errored), but that's absorbed too.
    const result = bridge.wireEnd.write(JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 2 }))
    // Returns true because closed was NOT set by the rejection (only stream internals are errored).
    expect(result).toBe(true)
    await tick()
    await tick()
    // No unhandledRejection → test passes (vitest would fail automatically if one escaped).
  })

  it("round-trip: multiple messages in both directions", async () => {
    const bridge = createStreamBridge()

    // FE→agent: write 2 messages via wireEnd
    const req1: AnyMessage = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }
    const req2: AnyMessage = { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/" } }

    // Read 2 from agentEnd.readable
    const reader = bridge.agentEnd.readable.getReader()
    bridge.wireEnd.write(JSON.stringify(req1))
    bridge.wireEnd.write(JSON.stringify(req2))

    const { value: v1 } = await reader.read()
    const { value: v2 } = await reader.read()
    reader.releaseLock()

    expect(v1).toEqual(req1)
    expect(v2).toEqual(req2)

    // agent→FE: write 2 from agentEnd.writable
    const notif1: AnyMessage = {
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk" } },
    }
    const notif2: AnyMessage = {
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "stop" } },
    }

    const fromAgent: string[] = []
    bridge.wireEnd.onLine((l) => fromAgent.push(l))

    const writer = bridge.agentEnd.writable.getWriter()
    await writer.write(notif1)
    await writer.write(notif2)
    writer.releaseLock()

    // Wait for drain
    await new Promise<void>((resolve) => {
      const check = () => {
        if (fromAgent.length >= 2) resolve()
        else setTimeout(check, 5)
      }
      check()
    })

    expect(fromAgent).toHaveLength(2)
    expect(JSON.parse(fromAgent[0]!)).toEqual(notif1)
    expect(JSON.parse(fromAgent[1]!)).toEqual(notif2)
  })
})
