/**
 * dictate.test.ts — finishListening + pending capture (slice dictate-to-input-polish + voice-pending).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DictatePendingRecovery } from "./dictate.svelte"

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

function createRecovery(overrides: Partial<DictatePendingRecovery> = {}): DictatePendingRecovery {
  return {
    hasPending: false,
    hydrate: vi.fn().mockResolvedValue(null),
    dismiss: vi.fn().mockResolvedValue(undefined),
    processBlob: vi.fn(async (_blob, _mimeType, ctx) => {
      try {
        const result = await ctx.transcribe(_blob)
        return { ok: true, text: result.text, recordingId: result.recordingId }
      } catch {
        return { ok: false, error: "dictate.error.transcribe" as const }
      }
    }),
    retry: vi.fn(),
    ...overrides,
  }
}

function createDictate(recovery = createRecovery()): {
  dictate: Dictate
  draft: ComposerDraft
  recovery: DictatePendingRecovery
} {
  const draft = new ComposerDraft()
  const dictate = new Dictate({ draft, mic: fakeMic, recovery })
  return { dictate, draft, recovery }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStart.mockResolvedValue(undefined)
  mockStop.mockResolvedValue({ blob: new Blob(["audio"]), mimeType: "audio/webm" })
  mockTranscribe.mockResolvedValue({ text: "hello world", recordingId: "" })
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
    const { dictate, draft, recovery } = createDictate()
    dictate.state = "listening"

    const result = await dictate.finishListening()

    expect(result).toEqual({ ok: true, text: "hello world" })
    expect(mockStop).toHaveBeenCalledOnce()
    expect(recovery.processBlob).toHaveBeenCalledOnce()
    expect(draft.text).toBe("")
    expect(dictate.state).toBe("idle")
  })

  it("listening with silent audio returns empty text", async () => {
    mockTranscribe.mockResolvedValue({ text: "   ", recordingId: "" })
    const { dictate, draft } = createDictate()
    dictate.state = "listening"

    const result = await dictate.finishListening()

    expect(result).toEqual({ ok: true, text: "" })
    expect(draft.text).toBe("")
  })

  it("busy without inFlight returns generic error without second transcribe", async () => {
    const { dictate, recovery } = createDictate()
    dictate.state = "busy"

    const result = await dictate.finishListening()

    expect(result).toEqual({ ok: false, error: "dictate.error.generic" })
    expect(recovery.processBlob).not.toHaveBeenCalled()
  })

  it("duplicate calls during inFlight return the same promise", async () => {
    let resolveTranscribe!: (value: { text: string; recordingId: string }) => void
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

    resolveTranscribe({ text: "shared", recordingId: "" })
    const [r1, r2] = await Promise.all([first, second])
    expect(r1).toEqual({ ok: true, text: "shared" })
    expect(r2).toEqual({ ok: true, text: "shared" })
    expect(mockTranscribe).toHaveBeenCalledOnce()
  })

  it("transcribe failure returns error, canRetry, and resets to idle", async () => {
    mockTranscribe.mockRejectedValue(new Error("network"))
    const { dictate, draft, recovery } = createDictate()
    recovery.hasPending = true
    dictate.state = "listening"

    const result = await dictate.finishListening()

    expect(result).toEqual({ ok: false, error: "dictate.error.transcribe" })
    expect(dictate.state).toBe("idle")
    expect(dictate.error).toBe("dictate.error.transcribe")
    expect(dictate.canRetry).toBe(true)
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
    mockTranscribe.mockResolvedValue({ text: "", recordingId: "" })
    const { dictate, draft } = createDictate()
    dictate.state = "listening"

    await dictate.toggle()

    expect(draft.text).toBe("")
  })
})

describe("Dictate pending capture retry", () => {
  it("retry success appends dictation and clears pending", async () => {
    const recovery = createRecovery({
      hasPending: true,
      retry: vi.fn().mockResolvedValue({ ok: true, text: "retry text", recordingId: "" }),
    })
    const { dictate, draft } = createDictate(recovery)

    await dictate.retryTranscribe()

    expect(recovery.retry).toHaveBeenCalledOnce()
    expect(draft.text).toBe("retry text")
    expect(dictate.state).toBe("idle")
  })
})
