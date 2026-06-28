import { describe, expect, it } from "vitest"
import { isBinary } from "../src/binary.js"

describe("isBinary()", () => {
  it("returns false in dev (no __IS_BINARY__ define)", () => {
    // In dev/test env, __IS_BINARY__ is not defined — isBinary() must return false.
    expect(isBinary()).toBe(false)
  })
})
