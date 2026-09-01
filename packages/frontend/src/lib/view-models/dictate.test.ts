/**
 * dictate.test.ts — finishListening + shared transcribe path (slice dictate-to-input-polish, C0).
 *
 * approach: tdd — mock Recorder + transcribe.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockStart, mockStop, mockTranscribe } = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockStop: vi.fn(),
  mockTranscribe: vi.fn(),
}))

vi.mock("../engines/recorder", () => ({
  Recorder: class MockRecorder {
    start = mockStart
    stop = mockStop
  },
}))

vi.mock("../adapters/voice/transcribe", () => ({
  transcribe: (...args: unknown[]) => mockTranscribe(...args),
}))

import { ComposerDraft } from "./composer-draft.svelte"
import { Dictate } from "./dictate.svelte"
import type { Mic } from "./mic.svelte"

const fakeMic = { state: "idle" } as Mic

function createDictate(): { dictate: Dictate; draft: ComposerDraft } {
  const draft = new ComposerDraft()
  const dictate = new Dictate({ draft, mic: fakeMic })
  return { dictate, draft }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStart.mockResolvedValue(undefined)
  mockStop.mockResolvedValue({ blob: new Blob(["audio"]), mimeType: "audio/webm" })
  mockTranscribe.mockResolvedValue({ text: "hello world" })
})

describe("Dictate.finishListening", () => {
  it("idle returns empty text without touching recorder", async () => {
    const { dictate } = createDictate()

    const result = await dictate.finishListening()

    expect(result).toEqual({ ok: true, text: "" })
    expect(mockStop).not.toHaveBeenCalled()
    expect(mockTranscribe).not.toHaveBeenCalled()
  })

  it("listening stops, transcribes, returns text without writing draft", async () => {
    const { dictate, draft } = createDictate()
    dictate.state = "listening"

    const result = await dictate.finishListening()

    expect(result).toEqual({ ok: true, text: "hello world" })
    expect(mockStop).toHaveBeenCalledOnce()
    expect(mockTranscribe).toHaveBeenCalledOnce()
    expect(draft.text).toBe("")
    expect(dictate.state).toBe("idle")
  })

  it("listening with silent audio returns empty text", async () => {
    mockTranscribe.mockResolvedValue({ text: "   " })
    const { dictate, draft } = createDictate()
    dictate.state = "listening"

    const result = await dictate.finishListening()

    expect(result).toEqual({ ok: true, text: "" })
    expect(draft.text).toBe("")
  })

  it("busy without inFlight returns generic error without second transcribe", async () => {
    const { dictate } = createDictate()
    dictate.state = "busy"

    const result = await dictate.finishListening()

    expect(result).toEqual({ ok: false, error: "dictate.error.generic" })
    expect(mockTranscribe).not.toHaveBeenCalled()
  })

  it("duplicate calls during inFlight return the same promise", async () => {
    let resolveTranscribe!: (value: { text: string }) => void
    mockTranscribe.mockReturnValue(
      new Promise((resolve) => {
        resolveTranscribe = resolve
      }),
    )
    const { dictate } = createDictate()
    dictate.state = "listening"

    const first = dictate.finishListening()
    const second = dictate.finishListening()

    expect(second).toBe(first)

    resolveTranscribe({ text: "shared" })
    const [r1, r2] = await Promise.all([first, second])
    expect(r1).toEqual({ ok: true, text: "shared" })
    expect(r2).toEqual({ ok: true, text: "shared" })
    expect(mockTranscribe).toHaveBeenCalledOnce()
  })

  it("transcribe failure returns error and resets to idle", async () => {
    mockTranscribe.mockRejectedValue(new Error("network"))
    const { dictate, draft } = createDictate()
    dictate.state = "listening"

    const result = await dictate.finishListening()

    expect(result).toEqual({ ok: false, error: "dictate.error.transcribe" })
    expect(dictate.state).toBe("idle")
    expect(dictate.error).toBe("dictate.error.transcribe")
    expect(draft.text).toBe("")
  })
})

describe("Dictate.toggle from listening", () => {
  it("appends transcribed text to draft", async () => {
    const { dictate, draft } = createDictate()
    dictate.state = "listening"

    await dictate.toggle()

    expect(draft.text).toBe("hello world")
    expect(dictate.state).toBe("idle")
  })

  it("does not append when transcribed text is empty", async () => {
    mockTranscribe.mockResolvedValue({ text: "" })
    const { dictate, draft } = createDictate()
    dictate.state = "listening"

    await dictate.toggle()

    expect(draft.text).toBe("")
  })
})
