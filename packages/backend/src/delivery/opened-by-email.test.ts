import { describe, expect, it } from "vitest"
import { readOpenedByEmail } from "./opened-by-email.js"

describe("readOpenedByEmail (slice session-attribution-core C1)", () => {
  it("returns undefined when header absent", () => {
    expect(readOpenedByEmail(undefined)).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(readOpenedByEmail("")).toBeUndefined()
  })

  it("returns undefined for whitespace only", () => {
    expect(readOpenedByEmail("   ")).toBeUndefined()
  })

  it("returns trimmed email", () => {
    expect(readOpenedByEmail("  test@x.com  ")).toBe("test@x.com")
  })
})
