import { describe, expect, it } from "vitest"
import { parseHistoryQuery } from "./history-query"

describe("parseHistoryQuery", () => {
  it("accepts tail=1 with maxBytes", () => {
    const r = parseHistoryQuery((k) =>
      k === "tail" ? "1" : k === "maxBytes" ? "65536" : undefined,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.opts.range).toEqual({ tail: true, maxBytes: 65536 })
  })

  it("rejects empty tail", () => {
    const r = parseHistoryQuery((k) => (k === "tail" ? "" : undefined))
    expect(r.ok).toBe(false)
  })

  it("rejects tail with before", () => {
    const r = parseHistoryQuery((k) =>
      k === "tail" ? "1" : k === "before" ? "5" : k === "maxBytes" ? "1000" : undefined,
    )
    expect(r.ok).toBe(false)
  })

  it("rejects maxBytes without range", () => {
    const r = parseHistoryQuery((k) => (k === "maxBytes" ? "1000" : undefined))
    expect(r.ok).toBe(false)
  })
})
