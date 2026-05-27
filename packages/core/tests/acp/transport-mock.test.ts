/**
 * transport-mock.test.ts — sanity tests for MockAcpTransport.
 *
 * The mock is part of the testing contract reused by downstream packages,
 * so we test it directly to lock in its observable behavior:
 *   1. emitFrame appends `\n` and the readable stream delivers the bytes.
 *   2. Writes to writable are captured in sentFrames, split on `\n`.
 *   3. close() fires onClose callbacks.
 *   4. emitFrame after close throws.
 */

import { describe, expect, test } from "vitest"
import { MockAcpTransport } from "../../src/acp/transport-mock.js"

const decoder = new TextDecoder()
const encoder = new TextEncoder()

describe("MockAcpTransport — readable side", () => {
  test("emitFrame appends \\n and delivers to readable", async () => {
    const t = new MockAcpTransport()
    t.emitFrame(`{"jsonrpc":"2.0","id":1,"result":{}}`)

    const reader = t.readable.getReader()
    const { value, done } = await reader.read()
    expect(done).toBe(false)
    expect(decoder.decode(value)).toBe(`{"jsonrpc":"2.0","id":1,"result":{}}\n`)
  })

  test("multiple emitFrame calls produce separate chunks", async () => {
    const t = new MockAcpTransport()
    t.emitFrame(`{"a":1}`)
    t.emitFrame(`{"b":2}`)

    const reader = t.readable.getReader()
    const first = await reader.read()
    const second = await reader.read()
    expect(decoder.decode(first.value)).toBe(`{"a":1}\n`)
    expect(decoder.decode(second.value)).toBe(`{"b":2}\n`)
  })
})

describe("MockAcpTransport — writable side", () => {
  test("single line write is captured in sentFrames (without \\n)", async () => {
    const t = new MockAcpTransport()
    const writer = t.writable.getWriter()
    await writer.write(encoder.encode(`{"jsonrpc":"2.0","method":"prompt"}\n`))
    writer.releaseLock()

    expect(t.sentFrames).toEqual([`{"jsonrpc":"2.0","method":"prompt"}`])
  })

  test("multi-line write is split into separate frames", async () => {
    const t = new MockAcpTransport()
    const writer = t.writable.getWriter()
    await writer.write(encoder.encode(`{"a":1}\n{"b":2}\n`))
    writer.releaseLock()

    expect(t.sentFrames).toEqual([`{"a":1}`, `{"b":2}`])
  })

  test("empty lines are filtered out", async () => {
    const t = new MockAcpTransport()
    const writer = t.writable.getWriter()
    await writer.write(encoder.encode(`{"a":1}\n\n\n{"b":2}\n`))
    writer.releaseLock()

    expect(t.sentFrames).toEqual([`{"a":1}`, `{"b":2}`])
  })
})

describe("MockAcpTransport — close semantics", () => {
  test("close() fires onClose listeners with default code", () => {
    const t = new MockAcpTransport()
    const events: Array<{ code: number; reason: string }> = []
    t.onClose((code, reason) => events.push({ code, reason }))

    t.close()

    expect(events).toEqual([{ code: 1000, reason: "client closed" }])
  })

  test("simulateClose fires onClose listeners with given code/reason", () => {
    const t = new MockAcpTransport()
    const events: Array<{ code: number; reason: string }> = []
    t.onClose((code, reason) => events.push({ code, reason }))

    t.simulateClose(1011, "bridge crashed")

    expect(events).toEqual([{ code: 1011, reason: "bridge crashed" }])
  })

  test("close is idempotent — onClose fires once", () => {
    const t = new MockAcpTransport()
    let count = 0
    t.onClose(() => count++)

    t.close()
    t.close()
    t.simulateClose(1011, "ignored")

    expect(count).toBe(1)
  })

  test("multiple listeners all fire", () => {
    const t = new MockAcpTransport()
    let a = 0
    let b = 0
    t.onClose(() => a++)
    t.onClose(() => b++)

    t.close()

    expect(a).toBe(1)
    expect(b).toBe(1)
  })

  test("emitFrame after close throws", () => {
    const t = new MockAcpTransport()
    t.close()

    expect(() => t.emitFrame(`{}`)).toThrow("cannot emit after close")
  })
})
