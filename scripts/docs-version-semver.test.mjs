import { compareSemver, docVersionWithinCap, parseSemver } from "./docs-version-semver.mjs"
import { describe, expect, it } from "vitest"

describe("parseSemver", () => {
  it("accepts plain semver triples", () => {
    expect(parseSemver("1.2.0")).toEqual({ major: 1, minor: 2, patch: 0 })
  })

  it("rejects non-semver", () => {
    expect(parseSemver("1.2")).toBeNull()
    expect(parseSemver("v1.2.0")).toBeNull()
    expect(parseSemver("not-a-version")).toBeNull()
  })
})

describe("compareSemver", () => {
  it("orders below / equal / above", () => {
    expect(compareSemver("1.2.0", "1.3.0")).toBe(-1)
    expect(compareSemver("1.3.0", "1.3.0")).toBe(0)
    expect(compareSemver("1.4.0", "1.3.0")).toBe(1)
  })

  it("returns null for invalid operands", () => {
    expect(compareSemver("x", "1.0.0")).toBeNull()
  })
})

describe("docVersionWithinCap (check 6)", () => {
  const cap = "1.3.0"

  it("allows strictly below cap", () => {
    expect(docVersionWithinCap("1.2.0", cap)).toEqual({ ok: true })
  })

  it("allows equal to cap", () => {
    expect(docVersionWithinCap("1.3.0", cap)).toEqual({ ok: true })
  })

  it("rejects above cap", () => {
    expect(docVersionWithinCap("1.4.0", cap)).toEqual({ ok: false, reason: "above DOCS_VERSION" })
  })

  it("rejects non-semver doc version", () => {
    expect(docVersionWithinCap("latest", cap)).toEqual({ ok: false, reason: "invalid semver" })
  })
})
