/**
 * tts-gemini.test.ts — Gemini TTS adapter (tts-model-choice).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { geminiTts } from "./tts-gemini"

const generateContentStream = vi.fn()

vi.mock("./sdks", () => ({
  googleGenAi: () => ({
    models: { generateContentStream },
  }),
}))

vi.mock("$lib/util/be-url", () => ({
  beUrl: vi.fn((path: string) => `http://localhost:4000${path}`),
  beWsUrl: vi.fn(),
  setBeUrlBase: vi.fn(),
}))

function mockStream(chunks: Array<{ data?: string }>) {
  async function* gen() {
    for (const c of chunks) {
      yield {
        candidates: [{ content: { parts: [{ inlineData: { data: c.data } }] } }],
      }
    }
  }
  generateContentStream.mockResolvedValue(gen())
}

describe("geminiTts.synthesize", () => {
  beforeEach(() => {
    generateContentStream.mockReset()
  })

  it("3.8 sends speechMetadata.style + verbatim text, no format override", async () => {
    mockStream([{ data: btoa(String.fromCharCode(1, 2)) }])
    const stream = await geminiTts.synthesize({
      text: "hello transcript",
      voiceId: "Kore",
      modelId: "gemini-3.8-flash-tts",
      directing: { tone: "calm", pace: "fast" },
    })
    expect(generateContentStream).toHaveBeenCalledOnce()
    const call = generateContentStream.mock.calls[0]?.[0]
    expect(call.model).toBe("gemini-3.8-flash-tts")
    expect(call.contents[0].parts[0].text).toBe("hello transcript")
    expect(call.contents[0].parts[0].speechMetadata).toEqual({
      style: "Style: Calm. Pace: Fast.",
    })
    expect(call.config.responseFormat).toBeUndefined()
    expect(call.config.responseModalities).toEqual(["AUDIO"])

    const reader = stream.getReader()
    const chunk = await reader.read()
    expect(chunk.value).toBeInstanceOf(Uint8Array)
    expect(chunk.value?.length).toBe(2)
  })

  it("3.1 keeps buildGeminiDirecting in Part.text without speechMetadata", async () => {
    mockStream([{ data: btoa("x") }])
    await geminiTts.synthesize({
      text: "plain",
      voiceId: "Kore",
      modelId: "gemini-3.1-flash-tts-preview",
      directing: { tone: "calm" },
    })
    const call = generateContentStream.mock.calls[0]?.[0]
    expect(call.contents[0].parts[0].speechMetadata).toBeUndefined()
    expect(call.contents[0].parts[0].text).toContain("Director's note")
    expect(call.contents[0].parts[0].text).toContain("plain")
    expect(call.config.responseFormat).toBeUndefined()
  })
})
