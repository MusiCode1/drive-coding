import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock @google/genai BEFORE importing the module under test
const generateContent = vi.fn()
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent }
  },
}))

const { geminiTranscription } = await import("../src/voice/providers/gemini-transcription")

describe("geminiTranscription provider", () => {
  beforeEach(() => {
    generateContent.mockReset()
    generateContent.mockResolvedValue({ text: "transcribed text" })
  })

  it("specificationVersion === 'v3'", () => {
    const provider = geminiTranscription("gemini-flash-latest")
    expect(provider.specificationVersion).toBe("v3")
  })

  it("modelId matches input", () => {
    const provider = geminiTranscription("gemini-flash-latest")
    expect(provider.modelId).toBe("gemini-flash-latest")

    const provider2 = geminiTranscription("gemini-2.5-pro")
    expect(provider2.modelId).toBe("gemini-2.5-pro")
  })

  it("provider field is 'gemini-transcription'", () => {
    const provider = geminiTranscription("any-model")
    expect(provider.provider).toBe("gemini-transcription")
  })

  it("doGenerate with audio bytes returns {text, segments, ...}", async () => {
    generateContent.mockResolvedValue({ text: "שלום עולם" })
    const provider = geminiTranscription("gemini-flash-latest")

    const result = await provider.doGenerate({
      audio: new Uint8Array([1, 2, 3, 4]),
      mediaType: "audio/webm",
    })

    expect(result.text).toBe("שלום עולם")
    expect(result.segments).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.response?.modelId).toBe("gemini-flash-latest")
  })

  it("doGenerate sends correct contents structure to GoogleGenAI", async () => {
    const provider = geminiTranscription("gemini-flash-latest")
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x44])
    await provider.doGenerate({
      audio,
      mediaType: "audio/mpeg",
    })

    expect(generateContent).toHaveBeenCalledOnce()
    const callArgs = generateContent.mock.calls[0]?.[0]
    expect(callArgs.model).toBe("gemini-flash-latest")
    expect(callArgs.contents).toHaveLength(1)
    const parts = callArgs.contents[0].parts
    // First part is text prompt, second is inline audio data
    expect(parts[0].text).toBeDefined()
    expect(parts[1].inlineData.mimeType).toBe("audio/mpeg")
    expect(parts[1].inlineData.data).toBe(Buffer.from(audio).toString("base64"))
  })

  it("doGenerate WITHOUT previousAssistantText → prompt is generic (no context)", async () => {
    const provider = geminiTranscription("gemini-flash-latest")
    await provider.doGenerate({
      audio: new Uint8Array([0]),
      mediaType: "audio/webm",
    })

    const callArgs = generateContent.mock.calls[0]?.[0]
    const promptText: string = callArgs.contents[0].parts[0].text
    expect(promptText).toMatch(/Transcribe the audio/i)
    expect(promptText).not.toMatch(/previous assistant/i)
  })

  it("doGenerate WITH previousAssistantText → prompt includes context quote", async () => {
    const provider = geminiTranscription("gemini-flash-latest")
    await provider.doGenerate({
      audio: new Uint8Array([0]),
      mediaType: "audio/webm",
      providerOptions: {
        gemini: { previousAssistantText: "I just told you about the moon." },
      },
    })

    const callArgs = generateContent.mock.calls[0]?.[0]
    const promptText: string = callArgs.contents[0].parts[0].text
    expect(promptText).toMatch(/previous assistant/i)
    expect(promptText).toContain("I just told you about the moon.")
  })

  it("doGenerate prompt always contains Hebrew script directive (no transliteration)", async () => {
    const provider = geminiTranscription("gemini-flash-latest")
    await provider.doGenerate({
      audio: new Uint8Array([0]),
      mediaType: "audio/webm",
    })

    const callArgs = generateContent.mock.calls[0]?.[0]
    const promptText: string = callArgs.contents[0].parts[0].text
    // learning 2026-05-16: Gemini transliterates Hebrew to Latin by default; must instruct otherwise
    expect(promptText).toMatch(/Hebrew/i)
    expect(promptText.toLowerCase()).toMatch(/(do not|don't|no).*transliterate|original script/i)
  })

  it("doGenerate handles base64 string audio input (not just Uint8Array)", async () => {
    const provider = geminiTranscription("gemini-flash-latest")
    const audioBytes = new Uint8Array([0xde, 0xad])
    const audioBase64 = Buffer.from(audioBytes).toString("base64")

    await provider.doGenerate({
      audio: audioBase64,
      mediaType: "audio/webm",
    })

    const callArgs = generateContent.mock.calls[0]?.[0]
    expect(callArgs.contents[0].parts[1].inlineData.data).toBe(audioBase64)
  })

  it("doGenerate empty response text → returns empty string (no crash)", async () => {
    generateContent.mockResolvedValue({ text: undefined })
    const provider = geminiTranscription("gemini-flash-latest")

    const result = await provider.doGenerate({
      audio: new Uint8Array([1]),
      mediaType: "audio/webm",
    })

    expect(result.text).toBe("")
  })
})
