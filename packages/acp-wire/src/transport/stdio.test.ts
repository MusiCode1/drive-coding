import { PassThrough } from "node:stream"
import { describe, expect, it } from "vitest"
import { createStdioTransport } from "./stdio.js"

describe("createStdioTransport", () => {
  it("exchanges bytes bidirectionally via toWeb streams", async () => {
    const fakeIn = new PassThrough()
    const fakeOut = new PassThrough()

    const transport = createStdioTransport({ stdin: fakeIn, stdout: fakeOut })

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    const writer = transport.writable.getWriter()
    await writer.write(encoder.encode('{"ping":1}\n'))
    writer.releaseLock()

    fakeIn.write('{"pong":2}\n')

    const reader = transport.readable.getReader()
    const { value } = await reader.read()
    reader.releaseLock()

    expect(decoder.decode(value)).toBe('{"pong":2}\n')
  })

  it("invokes onClose at most once when stdin ends", async () => {
    const fakeIn = new PassThrough()
    const fakeOut = new PassThrough()
    const transport = createStdioTransport({ stdin: fakeIn, stdout: fakeOut })

    let count = 0
    transport.onClose(() => {
      count++
    })

    fakeIn.end()
    await new Promise((r) => setTimeout(r, 10))
    fakeIn.emit("close")

    expect(count).toBeLessThanOrEqual(1)
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it("close() does not throw (does not kill process)", () => {
    const fakeIn = new PassThrough()
    const fakeOut = new PassThrough()
    const transport = createStdioTransport({ stdin: fakeIn, stdout: fakeOut })
    expect(() => transport.close()).not.toThrow()
  })
})
