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

  it("rejects empty before", () => {
    const r = parseHistoryQuery((k) =>
      k === "before" ? "" : k === "maxBytes" ? "1000" : undefined,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.body).toEqual({ error: "before must be a non-negative seq" })
  })

  it("rejects tail=1 without maxBytes", () => {
    const r = parseHistoryQuery((k) => (k === "tail" ? "1" : undefined))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.body).toEqual({ error: "maxBytes is required with tail or before" })
  })

  it("clamps large maxBytes", () => {
    const r = parseHistoryQuery((k) =>
      k === "tail" ? "1" : k === "maxBytes" ? "10000000" : undefined,
    )
    expect(r.ok).toBe(true)
    if (r.ok && r.opts.range && "tail" in r.opts.range) {
      expect(r.opts.range.maxBytes).toBeLessThanOrEqual(1_048_576)
    }
  })
})
