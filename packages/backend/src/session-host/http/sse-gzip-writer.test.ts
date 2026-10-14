import { describe, expect, it } from "vitest"
import { clientAcceptsGzip } from "./sse-gzip-writer.js"

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
