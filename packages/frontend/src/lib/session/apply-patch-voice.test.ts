/**
 * apply-patch-voice.test.ts — the voice-conversation mark on bubbles (slice codex-voice-poc).
 */

import { describe, expect, it } from "vitest"
import { voiceOfMeta } from "./apply-patch-mutable"

describe("voiceOfMeta", () => {
  it.each([
    ["user speech", { kind: "speech", role: "user" }, { kind: "speech", role: "user" }],
    ["voice speech", { kind: "speech", role: "assistant" }, { kind: "speech", role: "assistant" }],
    [
      "a handoff with context",
      { kind: "handoff", transcript: "user: hi" },
      { kind: "handoff", transcript: "user: hi" },
    ],
    ["a handoff without context", { kind: "handoff", transcript: "  " }, { kind: "handoff" }],
  ])("reads %s", (_name, mark, expected) => {
    expect(voiceOfMeta({ "_drive/voice": mark, other: 1 })).toEqual(expected)
  })

  it.each([
    ["no meta", undefined],
    ["meta without the mark", { other: 1 }],
    ["an unknown kind", { "_drive/voice": { kind: "whisper" } }],
    ["speech with an unknown role", { "_drive/voice": { kind: "speech", role: "system" } }],
  ])("ignores %s", (_name, meta) => {
    expect(voiceOfMeta(meta as Record<string, unknown> | undefined)).toBeUndefined()
  })
})
