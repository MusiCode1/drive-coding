/**
 * append-dictation.test.ts — TDD for appendDictation() pure separator rules (D3).
 * (slice dictate-to-input, C0)
 */

import { describe, expect, it } from "vitest"
import { appendDictation } from "./append-dictation"

describe("appendDictation", () => {
  it('empty existing + chunk → chunk only', () => {
    expect(appendDictation("", "hello")).toBe("hello")
  })

  it("non-empty existing + chunk → space-separated", () => {
    expect(appendDictation("draft", "hello")).toBe("draft hello")
  })

  it("existing trailing space → no double separator", () => {
    expect(appendDictation("draft ", "hello")).toBe("draft hello")
  })

  it("existing trailing newline → newline separator", () => {
    expect(appendDictation("draft\n", "hello")).toBe("draft\nhello")
  })

  it("empty or whitespace-only chunk → existing unchanged", () => {
    expect(appendDictation("draft", "")).toBe("draft")
    expect(appendDictation("draft", "  ")).toBe("draft")
  })

  it("trims chunk before append", () => {
    expect(appendDictation("draft", "  hello  ")).toBe("draft hello")
  })
})
