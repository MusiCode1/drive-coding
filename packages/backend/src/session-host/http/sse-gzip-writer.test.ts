import { describe, expect, it } from "vitest"
import { clientAcceptsGzip, createSseTextWriter, type SseWireWrite } from "./sse-gzip-writer.js"

describe("clientAcceptsGzip", () => {
  it("accepts gzip and x-gzip tokens", () => {
    expect(clientAcceptsGzip("gzip")).toBe(true)
    expect(clientAcceptsGzip("deflate, gzip, br")).toBe(true)
    expect(clientAcceptsGzip("x-gzip")).toBe(true)
  })

  it("rejects missing or identity-only", () => {
    expect(clientAcceptsGzip(undefined)).toBe(false)
    expect(clientAcceptsGzip("deflate, br")).toBe(false)
  })
})

describe("createSseTextWriter gzip backpressure", () => {
  it("writeWire resolves only after the gzip sink finishes each chunk", async () => {
    const order: string[] = []
    const sinkDelayMs = 8
    const gzipWrite: SseWireWrite = () => {
      return new Promise((resolve) => {
        setTimeout(() => {
          order.push("sink")
          resolve()
        }, sinkDelayMs)
      })
    }

    const { writeWire } = createSseTextWriter(true, () => {}, gzipWrite)
    await writeWire("event: snapshot\ndata: {}\n\n").then(() => {
      order.push("writeWire")
    })

    const writeWireIdx = order.indexOf("writeWire")
    expect(writeWireIdx).toBeGreaterThan(0)
    expect(order.slice(0, writeWireIdx).every((step) => step === "sink")).toBe(true)
  })
})
