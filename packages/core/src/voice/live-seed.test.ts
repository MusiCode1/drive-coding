/**
 * live-seed.test.ts — TDD for slice live-context, Commit 0.
 */

import { describe, expect, it } from "vitest"
import { buildLiveSeed, type LiveSeedBubble, type LiveSeedLabels } from "./live-seed"

const labels: LiveSeedLabels = {
  toolRan: (name) => `[tool ran: ${name}]`,
  toolFailed: (name) => `[tool failed: ${name}]`,
  permissionPending: "[permission pending]",
  agentRunning: "[agent running]",
  agentIdle: "[agent idle]",
}

function bubble(kind: LiveSeedBubble["kind"], text: string, turnIndex: number): LiveSeedBubble {
  return { kind, text, turnIndex }
}

describe("buildLiveSeed()", () => {
  it("returns empty seed for empty bubbles", () => {
    const result = buildLiveSeed(
      {
        bubbles: [],
        turnState: "idle",
        pendingPermission: null,
        lastUserMessage: null,
      },
      labels,
    )
    expect(result).toEqual({ turns: [], charCount: 0 })
  })

  it("carries full text for user and assistant bubbles", () => {
    const result = buildLiveSeed(
      {
        bubbles: [bubble("user", "hello", 0), bubble("assistant", "world", 1)],
        turnState: "idle",
        pendingPermission: null,
        lastUserMessage: null,
      },
      labels,
    )
    expect(result.turns).toEqual([{ text: "hello" }, { text: "world" }])
    expect(result.charCount).toBe("hello".length + "world".length)
  })

  it("redacts tool bubbles to status lines via labels", () => {
    const result = buildLiveSeed(
      {
        bubbles: [bubble("tool", "run_tests", 0)],
        turnState: "idle",
        pendingPermission: null,
        lastUserMessage: null,
      },
      labels,
    )
    expect(result.turns).toEqual([{ text: "[tool ran: run_tests]" }])
  })

  it("uses toolFailed label when tool text is prefixed with !", () => {
    const result = buildLiveSeed(
      {
        bubbles: [bubble("tool", "!deploy", 0)],
        turnState: "idle",
        pendingPermission: null,
        lastUserMessage: null,
      },
      labels,
    )
    expect(result.turns).toEqual([{ text: "[tool failed: deploy]" }])
  })

  it("passes status bubble text through unchanged", () => {
    const result = buildLiveSeed(
      {
        bubbles: [bubble("status", "[custom status]", 0)],
        turnState: "idle",
        pendingPermission: null,
        lastUserMessage: null,
      },
      labels,
    )
    expect(result.turns).toEqual([{ text: "[custom status]" }])
  })

  it("appends turnState status line at the end", () => {
    expect(
      buildLiveSeed(
        {
          bubbles: [bubble("user", "hi", 0)],
          turnState: "running",
          pendingPermission: null,
          lastUserMessage: null,
        },
        labels,
      ).turns,
    ).toEqual([{ text: "hi" }, { text: "[agent running]" }])

    expect(
      buildLiveSeed(
        {
          bubbles: [],
          turnState: "awaiting-permission",
          pendingPermission: { toolName: "write_file" },
          lastUserMessage: null,
        },
        labels,
      ).turns,
    ).toEqual([{ text: "[permission pending]" }])
  })

  it("appends lastUserMessage when not already the last user bubble", () => {
    const result = buildLiveSeed(
      {
        bubbles: [bubble("user", "earlier", 0)],
        turnState: "idle",
        pendingPermission: null,
        lastUserMessage: "in flight",
      },
      labels,
    )
    expect(result.turns).toEqual([{ text: "earlier" }, { text: "in flight" }])
  })

  it("does not duplicate lastUserMessage when it matches the last user bubble", () => {
    const result = buildLiveSeed(
      {
        bubbles: [bubble("user", "same", 0)],
        turnState: "idle",
        pendingPermission: null,
        lastUserMessage: "same",
      },
      labels,
    )
    expect(result.turns).toEqual([{ text: "same" }])
  })

  it("limits to maxTurns (default 4) keeping the most recent", () => {
    const bubbles = [
      bubble("user", "t1", 0),
      bubble("user", "t2", 1),
      bubble("user", "t3", 2),
      bubble("user", "t4", 3),
      bubble("user", "t5", 4),
    ]
    const result = buildLiveSeed(
      {
        bubbles,
        turnState: "idle",
        pendingPermission: null,
        lastUserMessage: null,
      },
      labels,
    )
    expect(result.turns.map((t) => t.text)).toEqual(["t2", "t3", "t4", "t5"])
  })

  it("respects maxChars by dropping oldest turns and keeping the last", () => {
    const result = buildLiveSeed(
      {
        bubbles: [bubble("user", "AAAA", 0), bubble("user", "BBBB", 1), bubble("user", "CCCC", 2)],
        turnState: "idle",
        pendingPermission: null,
        lastUserMessage: null,
        maxChars: 10,
      },
      labels,
    )
    expect(result.turns.map((t) => t.text)).toEqual(["BBBB", "CCCC"])
    expect(result.charCount).toBeLessThanOrEqual(10)
  })

  it("applies maxTurns and maxChars together", () => {
    const result = buildLiveSeed(
      {
        bubbles: [
          bubble("user", "one", 0),
          bubble("user", "two", 1),
          bubble("user", "three", 2),
          bubble("user", "four", 3),
          bubble("user", "five", 4),
        ],
        turnState: "idle",
        pendingPermission: null,
        lastUserMessage: null,
        maxTurns: 3,
        maxChars: 12,
      },
      labels,
    )
    expect(result.turns.map((t) => t.text)).toEqual(["four", "five"])
    expect(result.charCount).toBeLessThanOrEqual(12)
  })

  it("charCount reflects final turn texts only", () => {
    const result = buildLiveSeed(
      {
        bubbles: [bubble("user", "abc", 0), bubble("assistant", "def", 1)],
        turnState: "idle",
        pendingPermission: null,
        lastUserMessage: null,
      },
      labels,
    )
    expect(result.charCount).toBe(6)
  })
})
