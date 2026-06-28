/**
 * schema.test.ts — TDD (Red → Green) for extMethods registry and parseExtParams.
 *
 * Phase 0: schema validates valid params (including n=null); rejects invalid (missing n,
 * wrong type for n, sessionId not string).
 */

import { describe, expect, it } from "vitest"
import { parseExtParams } from "./types.js"

describe("parseExtParams — _drive/setThinkingTokens", () => {
  it("accepts valid params with n as positive number", () => {
    const result = parseExtParams("_drive/setThinkingTokens", {
      sessionId: "sess-abc",
      n: 8000,
    })
    expect(result).toEqual({ sessionId: "sess-abc", n: 8000 })
  })

  it("accepts valid params with n=null (no-limit)", () => {
    const result = parseExtParams("_drive/setThinkingTokens", {
      sessionId: "sess-xyz",
      n: null,
    })
    expect(result).toEqual({ sessionId: "sess-xyz", n: null })
  })

  it("accepts n=0 (zero thinking tokens)", () => {
    const result = parseExtParams("_drive/setThinkingTokens", {
      sessionId: "s",
      n: 0,
    })
    expect(result).toEqual({ sessionId: "s", n: 0 })
  })

  it("rejects when n is missing", () => {
    expect(() =>
      parseExtParams("_drive/setThinkingTokens", {
        sessionId: "sess-abc",
      }),
    ).toThrow()
  })

  it("rejects when n is a string", () => {
    expect(() =>
      parseExtParams("_drive/setThinkingTokens", {
        sessionId: "sess-abc",
        n: "8000",
      }),
    ).toThrow()
  })

  it("rejects when sessionId is missing", () => {
    expect(() =>
      parseExtParams("_drive/setThinkingTokens", {
        n: 8000,
      }),
    ).toThrow()
  })

  it("rejects when sessionId is a number", () => {
    expect(() =>
      parseExtParams("_drive/setThinkingTokens", {
        sessionId: 123,
        n: 8000,
      }),
    ).toThrow()
  })

  it("rejects when params is not an object", () => {
    expect(() =>
      parseExtParams("_drive/setThinkingTokens", "invalid"),
    ).toThrow()
  })

  it("rejects when params is null", () => {
    expect(() =>
      parseExtParams("_drive/setThinkingTokens", null),
    ).toThrow()
  })
})
