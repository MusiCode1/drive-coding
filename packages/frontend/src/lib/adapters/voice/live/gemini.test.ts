/**
 * gemini.test.ts — normalization unit tests (no network).
 */

import { describe, expect, it } from "vitest"
import { normalizeGeminiFrame } from "./gemini.js"

describe("normalizeGeminiFrame()", () => {
  it("maps input transcription to user transcript", () => {
    const events = normalizeGeminiFrame({
      serverContent: { inputTranscription: { text: "שלום" } },
    })
    expect(events).toEqual([
      { type: "transcript", role: "user", text: "שלום", final: false },
    ])
  })

  it("maps toolCall to action events", () => {
    const events = normalizeGeminiFrame({
      toolCall: {
        functionCalls: [
          { id: "c1", name: "compose_prompt", args: { text: "auth.test.ts" } },
        ],
      },
    })
    expect(events).toEqual([
      { type: "action", id: "c1", name: "compose_prompt", args: { text: "auth.test.ts" } },
    ])
  })

  it("maps inlineData to audio pcm", () => {
    const pcm = new Uint8Array([1, 2, 3])
    const b64 = Buffer.from(pcm).toString("base64")
    const events = normalizeGeminiFrame({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: b64 } }] } },
    })
    expect(events[0]?.type).toBe("audio")
    if (events[0]?.type === "audio") {
      expect(events[0].pcm).toEqual(pcm)
    }
  })

  it("maps turnComplete to turn_done assistant", () => {
    const events = normalizeGeminiFrame({ serverContent: { turnComplete: true } })
    expect(events).toEqual([{ type: "turn_done", role: "assistant" }])
  })

  it("maps usageMetadata to usage event", () => {
    const events = normalizeGeminiFrame({
      usageMetadata: { totalTokenCount: 100, promptTokenCount: 40 },
    })
    expect(events).toEqual([{ type: "usage", totalTokens: 100, promptTokens: 40 }])
  })
})
