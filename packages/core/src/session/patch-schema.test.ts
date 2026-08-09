/**
 * patch-schema.test.ts — TDD for PatchSchema (ArkType wire-boundary validation).
 *
 * Testing: tdd
 *
 * ─── calev-heavy remote-session-view round 3 root-cause fix ───
 */
import { type } from "arktype"
import { describe, expect, it } from "vitest"
import { PatchSchema } from "./patch-schema"

function isValid(raw: unknown): boolean {
  return !(PatchSchema(raw) instanceof type.errors)
}

describe("PatchSchema — valid patches", () => {
  it("accepts append-segment", () => {
    expect(
      isValid({
        version: 1,
        op: "append-segment",
        targetId: "m_0",
        segment: { id: "s_0", text: "hi" },
      }),
    ).toBe(true)
  })

  it("accepts add-message (non-tool)", () => {
    expect(
      isValid({
        version: 1,
        op: "add-message",
        message: { id: "m_0", role: "assistant", messageId: "p1", segments: [] },
      }),
    ).toBe(true)
  })

  it("accepts add-message (tool)", () => {
    expect(
      isValid({
        version: 1,
        op: "add-message",
        message: {
          id: "m_0",
          role: "tool",
          messageId: null,
          toolCall: { toolCallId: "tc1", name: "read", status: "pending", args: {} },
        },
      }),
    ).toBe(true)
  })

  it("accepts update-tool", () => {
    expect(
      isValid({
        version: 1,
        op: "update-tool",
        targetId: "m_0",
        toolCall: { status: "completed" },
      }),
    ).toBe(true)
  })

  it("accepts reset", () => {
    expect(
      isValid({ version: 1, op: "reset", messages: [], nextMessageSeq: 0, nextSegmentSeq: 0 }),
    ).toBe(true)
  })

  it("accepts update-session", () => {
    expect(isValid({ version: 1, op: "update-session", changes: { title: "hi" } })).toBe(true)
  })
})

describe("PatchSchema — invalid patches (calev-heavy round 2/3 scenario)", () => {
  it("rejects an unknown op (BE/FE version skew — the exact scenario calev measured)", () => {
    expect(isValid({ version: 2, op: "update-quota", quota: { used: 1 } })).toBe(false)
  })

  it("rejects a missing required field", () => {
    expect(isValid({ version: 1, op: "append-segment", targetId: "m_0" })).toBe(false)
  })

  it("rejects a wrong-typed version", () => {
    expect(
      isValid({
        version: "1",
        op: "append-segment",
        targetId: "m_0",
        segment: { id: "s_0", text: "hi" },
      }),
    ).toBe(false)
  })

  it("rejects a bare string", () => {
    expect(isValid("not a patch")).toBe(false)
  })

  it("rejects null", () => {
    expect(isValid(null)).toBe(false)
  })
})
