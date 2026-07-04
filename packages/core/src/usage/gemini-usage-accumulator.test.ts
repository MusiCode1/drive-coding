/**
 * gemini-usage-accumulator.test.ts — TDD for createGeminiUsageAccumulator
 *
 * Approach: RED first (file written before implementation), then GREEN.
 *
 * Covers:
 *   (א) chunk split באמצע שורה (line boundary)
 *   (ב) chunk split באמצע תו-utf8 (utf8 boundary)
 *   (ג) usageMetadata רק בחלק האחרון (last-wins)
 *   (ד) input עם audio ענק → result נכון, זיכרון לא-צובר audio
 */

import { describe, expect, it } from "vitest"
import { createGeminiUsageAccumulator } from "./gemini-usage-accumulator.js"

const enc = new TextEncoder()

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** מפצל מחרוזת ל-N chunks שווים (כמעט) */
function splitIntoChunks(str: string, n: number): Uint8Array[] {
  const bytes = enc.encode(str)
  const chunkSize = Math.ceil(bytes.length / n)
  const result: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += chunkSize) {
    result.push(bytes.slice(i, i + chunkSize))
  }
  return result
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SSE_LINE_WITH_USAGE = (inputTokens: number, audioTokens: number) =>
  `data: {"candidates":[{"content":{"parts":[{"text":"hi"}],"role":"model"}}],"usageMetadata":{"promptTokenCount":${inputTokens},"candidatesTokenCount":${audioTokens},"candidatesTokensDetails":[{"modality":"AUDIO","tokenCount":${audioTokens}}]}}\r\n\r\n`

const SSE_CHUNK_NO_USAGE = `data: {"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/mp3","data":"AAAA..."}}],"role":"model"}}]}\r\n\r\n`

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createGeminiUsageAccumulator", () => {
  it("returns zeros on empty input", () => {
    const acc = createGeminiUsageAccumulator()
    expect(acc.result()).toEqual({ inputTokens: 0, audioTokens: 0 })
  })

  it("extracts usage from a single complete chunk", () => {
    const acc = createGeminiUsageAccumulator()
    acc.push(enc.encode(SSE_LINE_WITH_USAGE(10, 45)))
    expect(acc.result()).toEqual({ inputTokens: 10, audioTokens: 45 })
  })

  it("(א) handles line boundary: SSE line split across two chunks", () => {
    const fullSse = SSE_LINE_WITH_USAGE(12, 60)
    // חתוך בדיוק באמצע השורה
    const mid = Math.floor(enc.encode(fullSse).length / 2)
    const bytes = enc.encode(fullSse)
    const chunk1 = bytes.slice(0, mid)
    const chunk2 = bytes.slice(mid)

    const acc = createGeminiUsageAccumulator()
    acc.push(chunk1)
    // לפני chunk2 — result עדיין null/zeros (שורה לא שלמה)
    acc.push(chunk2)
    expect(acc.result()).toEqual({ inputTokens: 12, audioTokens: 60 })
  })

  it("(ב) handles utf8 boundary: multi-byte char split across chunks", () => {
    // שם ב-JSON שמכיל תו עברי רב-בייטי ("שלום" = 4 תווים = 8 בייטים UTF-8)
    // נשים אותו בשדה שלא משפיע על ה-usage כדי לבדוק parse תקין
    const sseWithHebrew = `data: {"candidates":[{"content":{"parts":[{"text":"שלום"}],"role":"model"}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":33,"candidatesTokensDetails":[{"modality":"AUDIO","tokenCount":33}]}}\r\n\r\n`
    const bytes = enc.encode(sseWithHebrew)
    // חתוך בדיוק באמצע תו עברי (כל תו עברי = 2 בייטים ב-UTF-8)
    // מוצא את "שלום" בבייטים וחותך אחרי הבייט הראשון של "ש"
    const hebrewStartIndex = bytes.indexOf(0xd7) // 0xD7 0xA9 = "ש"
    const splitAt = hebrewStartIndex + 1 // אחרי הבייט הראשון של "ש"

    const chunk1 = bytes.slice(0, splitAt)
    const chunk2 = bytes.slice(splitAt)

    const acc = createGeminiUsageAccumulator()
    acc.push(chunk1)
    acc.push(chunk2)
    expect(acc.result()).toEqual({ inputTokens: 7, audioTokens: 33 })
  })

  it("(ג) last-wins: usageMetadata only in final chunk", () => {
    const audioChunk1 = enc.encode(SSE_CHUNK_NO_USAGE)
    const audioChunk2 = enc.encode(SSE_CHUNK_NO_USAGE)
    const usageChunk = enc.encode(SSE_LINE_WITH_USAGE(15, 80))

    const acc = createGeminiUsageAccumulator()
    acc.push(audioChunk1)
    acc.push(audioChunk2)
    // result() לפני usage chunk → zeros
    expect(acc.result()).toEqual({ inputTokens: 0, audioTokens: 0 })
    acc.push(usageChunk)
    // אחרי usage chunk → נכון
    expect(acc.result()).toEqual({ inputTokens: 15, audioTokens: 80 })
  })

  it("last-wins: if multiple chunks have usageMetadata, last one wins", () => {
    const first = enc.encode(SSE_LINE_WITH_USAGE(5, 20))
    const last = enc.encode(SSE_LINE_WITH_USAGE(10, 50))

    const acc = createGeminiUsageAccumulator()
    acc.push(first)
    acc.push(last)
    // last-wins: ה-usageMetadata האחרון
    expect(acc.result()).toEqual({ inputTokens: 10, audioTokens: 50 })
  })

  it("(ד) large audio inline data does not affect result — only usage numbers returned", () => {
    // מדמה chunk עם inlineData ענק (base64 audio)
    const LARGE_AUDIO_B64 = "A".repeat(256 * 1024) // 256KB base64
    const hugeChunk = `data: {"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/mp3","data":"${LARGE_AUDIO_B64}"}}],"role":"model"}}],"usageMetadata":{"promptTokenCount":20,"candidatesTokenCount":100,"candidatesTokensDetails":[{"modality":"AUDIO","tokenCount":100}]}}\r\n\r\n`

    const acc = createGeminiUsageAccumulator()
    acc.push(enc.encode(hugeChunk))
    // ה-result אמור להכיל רק מספרים, לא את ה-inlineData
    const result = acc.result()
    expect(result).toEqual({ inputTokens: 20, audioTokens: 100 })
    // בדיקת zero-retain: ה-accumulator לא אמור לשמור audio
    // (בדיקה אפשרית רק ברמת ה-implementation review, לא ברמת ה-API)
  })

  it("fallback to candidatesTokenCount when no AUDIO detail", () => {
    const sseFallback = `data: {"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":42}}\r\n\r\n`
    const acc = createGeminiUsageAccumulator()
    acc.push(enc.encode(sseFallback))
    expect(acc.result()).toEqual({ inputTokens: 8, audioTokens: 42 })
  })

  it("handles [DONE] sentinel without crashing", () => {
    const sseWithDone = `${SSE_LINE_WITH_USAGE(5, 25)}data: [DONE]\r\n\r\n`
    const acc = createGeminiUsageAccumulator()
    acc.push(enc.encode(sseWithDone))
    expect(acc.result()).toEqual({ inputTokens: 5, audioTokens: 25 })
  })

  it("handles multiple chunks split into many small pieces", () => {
    const fullSse = `${SSE_CHUNK_NO_USAGE}${SSE_CHUNK_NO_USAGE}${SSE_LINE_WITH_USAGE(3, 17)}`
    const chunks = splitIntoChunks(fullSse, 20)

    const acc = createGeminiUsageAccumulator()
    for (const chunk of chunks) {
      acc.push(chunk)
    }
    expect(acc.result()).toEqual({ inputTokens: 3, audioTokens: 17 })
  })
})
