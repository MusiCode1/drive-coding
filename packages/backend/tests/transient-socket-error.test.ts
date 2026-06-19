/**
 * transient-socket-error.test.ts — TDD for isTransientSocketError
 *
 * Red-Green-Refactor: this file was written before the implementation.
 *
 * Verifies the classifier:
 *   - known transient codes → true
 *   - unknown code (EACCES) → false
 *   - undefined / null / object without code → false
 */

import { describe, expect, it } from "vitest"
import { isTransientSocketError } from "../src/delivery/transient-socket-error.js"

describe("isTransientSocketError", () => {
  it("ECONNRESET → true", () => {
    const err = Object.assign(new Error("connection reset"), { code: "ECONNRESET" })
    expect(isTransientSocketError(err)).toBe(true)
  })

  it("EPIPE → true", () => {
    const err = Object.assign(new Error("broken pipe"), { code: "EPIPE" })
    expect(isTransientSocketError(err)).toBe(true)
  })

  it("ENOTCONN → true", () => {
    const err = Object.assign(new Error("not connected"), { code: "ENOTCONN" })
    expect(isTransientSocketError(err)).toBe(true)
  })

  it("ECONNABORTED → true", () => {
    const err = Object.assign(new Error("aborted"), { code: "ECONNABORTED" })
    expect(isTransientSocketError(err)).toBe(true)
  })

  it("ETIMEDOUT → true", () => {
    const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })
    expect(isTransientSocketError(err)).toBe(true)
  })

  it("EACCES (not transient) → false", () => {
    const err = Object.assign(new Error("permission denied"), { code: "EACCES" })
    expect(isTransientSocketError(err)).toBe(false)
  })

  it("Error with no code property → false", () => {
    expect(isTransientSocketError(new Error("some error"))).toBe(false)
  })

  it("code is undefined explicitly → false", () => {
    const err = Object.assign(new Error("ws error"), { code: undefined })
    expect(isTransientSocketError(err)).toBe(false)
  })

  it("null → false", () => {
    expect(isTransientSocketError(null)).toBe(false)
  })

  it("plain object without code → false", () => {
    expect(isTransientSocketError({ message: "oops" })).toBe(false)
  })

  it("string → false", () => {
    expect(isTransientSocketError("ECONNRESET")).toBe(false)
  })
})
