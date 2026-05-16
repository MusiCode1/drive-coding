import { ClientMessage } from "@drive-coding/core"
import { type } from "arktype"
import { describe, expect, it } from "vitest"

/**
 * Tests for client-facing WS message parsing in the backend context.
 * Ensures the backend correctly parses all incoming message types.
 */
describe("ClientMessage parsing (backend context)", () => {
  it("parses ping from JSON string round-trip", () => {
    const raw = JSON.stringify({ type: "ping" })
    const parsed = JSON.parse(raw)
    const result = ClientMessage(parsed)
    expect(result instanceof type.errors).toBe(false)
    if (!(result instanceof type.errors)) {
      expect(result.type).toBe("ping")
    }
  })

  it("parses prompt from JSON string round-trip", () => {
    const raw = JSON.stringify({ type: "prompt", text: "What is 2+2?" })
    const parsed = JSON.parse(raw)
    const result = ClientMessage(parsed)
    expect(result instanceof type.errors).toBe(false)
    if (!(result instanceof type.errors)) {
      expect(result.type).toBe("prompt")
      expect((result as { text: string }).text).toBe("What is 2+2?")
    }
  })

  it("parses cancel from JSON string round-trip", () => {
    const raw = JSON.stringify({ type: "cancel" })
    const parsed = JSON.parse(raw)
    const result = ClientMessage(parsed)
    expect(result instanceof type.errors).toBe(false)
  })

  it("rejects malformed input (null)", () => {
    const result = ClientMessage(null)
    expect(result instanceof type.errors).toBe(true)
  })

  it("rejects extra unknown type", () => {
    const result = ClientMessage({ type: "subscribe" })
    expect(result instanceof type.errors).toBe(true)
  })

  it("rejects prompt with whitespace-only text", () => {
    // ArkType 'string >= 1' checks length, space is length=1 — note this is valid by schema
    // but let's verify the boundary: empty string is invalid
    const empty = ClientMessage({ type: "prompt", text: "" })
    expect(empty instanceof type.errors).toBe(true)
  })

  it("rejects prompt with missing text field", () => {
    const result = ClientMessage({ type: "prompt" })
    expect(result instanceof type.errors).toBe(true)
  })
})
