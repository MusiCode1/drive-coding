/**
 * extract.test.ts — TDD for extractElevenLabsChars + extractGeminiUsage
 * Commit 1: RED first, then GREEN
 */

import { describe, expect, it } from "vitest"
import { extractElevenLabsChars, extractGeminiUsage } from "./extract.js"

// ─── ElevenLabs ──────────────────────────────────────────────────────────────

describe("extractElevenLabsChars", () => {
  it("extracts char count from JSON body with text field", () => {
    const body = JSON.stringify({ text: "Hello world", model_id: "eleven_multilingual_v2" })
    expect(extractElevenLabsChars(new TextEncoder().encode(body))).toBe(11)
  })

  it("works with string input", () => {
    const body = JSON.stringify({ text: "שלום" })
    expect(extractElevenLabsChars(body)).toBe(4)
  })

  it("returns 0 for empty text", () => {
    const body = JSON.stringify({ text: "" })
    expect(extractElevenLabsChars(body)).toBe(0)
  })

  it("returns 0 on parse failure (not JSON)", () => {
    expect(extractElevenLabsChars("not json at all")).toBe(0)
  })

  it("returns 0 when text field is missing", () => {
    const body = JSON.stringify({ model_id: "eleven_multilingual_v2" })
    expect(extractElevenLabsChars(body)).toBe(0)
  })

  it("returns 0 when text is not a string", () => {
    const body = JSON.stringify({ text: 12345 })
    expect(extractElevenLabsChars(body)).toBe(0)
  })

  it("handles empty Uint8Array", () => {
    expect(extractElevenLabsChars(new Uint8Array(0))).toBe(0)
  })
})

// ─── Gemini SSE fixtures ──────────────────────────────────────────────────────

// Minimal Gemini SSE response fixture with candidatesTokensDetails (accurate audio)
const GEMINI_SSE_WITH_DETAILS = `data: {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":50,"totalTokenCount":60,"candidatesTokensDetails":[{"modality":"AUDIO","tokenCount":45},{"modality":"TEXT","tokenCount":5}]}}\r\n\r\ndata: [DONE]\r\n\r\n`

// Minimal Gemini SSE fixture WITHOUT candidatesTokensDetails (fallback to candidatesTokenCount)
const GEMINI_SSE_WITHOUT_DETAILS = `data: {"candidates":[{"content":{"parts":[{"text":"Shalom"}],"role":"model"}}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":42,"totalTokenCount":50}}\r\n\r\n`

// Multiple SSE chunks — usageMetadata from the LAST one should be used
const GEMINI_SSE_MULTI_CHUNK = [
  `data: {"candidates":[{"content":{"parts":[{"text":"chunk1"}],"role":"model"}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":10}}\r\n\r\n`,
  `data: {"candidates":[{"content":{"parts":[{"text":"chunk2"}],"role":"model"}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":30,"candidatesTokensDetails":[{"modality":"AUDIO","tokenCount":25}]}}\r\n\r\n`,
].join("")

// JSON array format (alternative Gemini response format)
const GEMINI_JSON_ARRAY = JSON.stringify([
  {
    candidates: [{ content: { parts: [{ text: "hi" }], role: "model" } }],
    usageMetadata: {
      promptTokenCount: 3,
      candidatesTokenCount: 7,
      candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 7 }],
    },
  },
])

describe("extractGeminiUsage", () => {
  it("extracts inputTokens and audio audioTokens from candidatesTokensDetails", () => {
    const result = extractGeminiUsage(GEMINI_SSE_WITH_DETAILS)
    expect(result.inputTokens).toBe(10)
    expect(result.audioTokens).toBe(45) // from candidatesTokensDetails[AUDIO]
  })

  it("falls back to candidatesTokenCount when no candidatesTokensDetails", () => {
    const result = extractGeminiUsage(GEMINI_SSE_WITHOUT_DETAILS)
    expect(result.inputTokens).toBe(8)
    // fallback: candidatesTokenCount (TTS output is audio-only, good estimate)
    expect(result.audioTokens).toBe(42)
  })

  it("reads the LAST usageMetadata in multi-chunk SSE", () => {
    const result = extractGeminiUsage(GEMINI_SSE_MULTI_CHUNK)
    expect(result.inputTokens).toBe(5)
    expect(result.audioTokens).toBe(25) // from last chunk's AUDIO detail
  })

  it("parses JSON array format", () => {
    const result = extractGeminiUsage(GEMINI_JSON_ARRAY)
    expect(result.inputTokens).toBe(3)
    expect(result.audioTokens).toBe(7)
  })

  it("returns zeros on parse failure", () => {
    const result = extractGeminiUsage("not valid SSE or JSON")
    expect(result.inputTokens).toBe(0)
    expect(result.audioTokens).toBe(0)
  })

  it("returns zeros when usageMetadata is absent", () => {
    const noMeta = `data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\r\n\r\n`
    const result = extractGeminiUsage(noMeta)
    expect(result.inputTokens).toBe(0)
    expect(result.audioTokens).toBe(0)
  })

  it("works with Uint8Array input", () => {
    const bytes = new TextEncoder().encode(GEMINI_SSE_WITH_DETAILS)
    const result = extractGeminiUsage(bytes)
    expect(result.inputTokens).toBe(10)
    expect(result.audioTokens).toBe(45)
  })

  it("ignores non-AUDIO modality in candidatesTokensDetails", () => {
    // Only TEXT modality — should fallback to candidatesTokenCount for audio
    const sseTextOnly = `data: {"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":20,"candidatesTokensDetails":[{"modality":"TEXT","tokenCount":20}]}}\r\n\r\n`
    const result = extractGeminiUsage(sseTextOnly)
    expect(result.inputTokens).toBe(5)
    // No AUDIO entry → fallback to candidatesTokenCount
    expect(result.audioTokens).toBe(20)
  })
})
