/**
 * live-seed-from-session.test.ts — bubble → LiveSeedBubble mapping.
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import type { Bubble } from "$lib/types/bubble"
import {
  mapBubblesToLiveSeed,
  mapBubblesToRecent,
  mapSessionTurnState,
} from "./live-seed-from-session"

describe("mapBubblesToRecent", () => {
  it("keeps thoughts and full tool args/output", () => {
    const bubbles = [
      {
        kind: "user",
        id: "u1",
        messageId: null,
        createdAt: 0,
        segments: [{ id: "s1", text: "hi" }],
      },
      {
        kind: "thought",
        id: "t1",
        messageId: "m",
        createdAt: 1,
        segments: [{ id: "s2", text: "secret" }],
      },
      {
        kind: "tool",
        id: "tool1",
        messageId: null,
        createdAt: 2,
        segments: [],
        toolCall: {
          toolCallId: "tc1",
          name: "Read",
          args: { path: "auth.ts" },
          status: "completed",
          content: [{ type: "text", text: "export const x = 1" }],
        },
      },
    ] as Bubble[]

    expect(mapBubblesToRecent(bubbles)).toEqual([
      { role: "user", text: "hi", turnIndex: 0 },
      { role: "thought", text: "secret", turnIndex: 1 },
      {
        role: "tool",
        text: "Read",
        turnIndex: 2,
        tool: {
          name: "Read",
          status: "completed",
          args: '{"path":"auth.ts"}',
          output: "export const x = 1",
        },
      },
    ])
  })
})

describe("mapBubblesToLiveSeed", () => {
  it("maps user/message, drops thoughts, encodes failed tools", () => {
    const bubbles = [
      {
        kind: "user",
        id: "u1",
        messageId: null,
        createdAt: 0,
        segments: [{ id: "s1", text: "hi" }],
      },
      {
        kind: "thought",
        id: "t1",
        messageId: "m",
        createdAt: 1,
        segments: [{ id: "s2", text: "secret" }],
      },
      {
        kind: "message",
        id: "a1",
        messageId: "m2",
        createdAt: 2,
        segments: [{ id: "s3", text: "hello" }],
      },
      {
        kind: "tool",
        id: "tool1",
        messageId: null,
        createdAt: 3,
        segments: [],
        toolCall: {
          toolCallId: "tc1",
          name: "Bash",
          args: {},
          status: "failed",
        },
      },
    ] as Bubble[]

    expect(mapBubblesToLiveSeed(bubbles)).toEqual([
      { kind: "user", text: "hi", turnIndex: 0 },
      { kind: "assistant", text: "hello", turnIndex: 1 },
      { kind: "tool", text: "!Bash", turnIndex: 2 },
    ])
  })
})

describe("mapSessionTurnState", () => {
  it("maps permission / idle / running", () => {
    expect(mapSessionTurnState("idle", true)).toBe("awaiting-permission")
    expect(mapSessionTurnState("idle", false)).toBe("idle")
    expect(mapSessionTurnState("responding", false)).toBe("running")
  })
})
