/**
 * voice-preview.test.ts — a failing sample reports why; a clip that ends or is stopped reports
 * nothing (slice codex-voice-poc). The silent branches are the ones pinned here: a sample that
 * failed used to look exactly like one that ended.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { playVoicePreview } from "./voice-preview"

class FakeAudio {
  static last: FakeAudio | null = null
  static playResult: Promise<void> = Promise.resolve()
  src: string
  error: { code: number; message: string } | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  pause = vi.fn()
  constructor(src: string) {
    this.src = src
    FakeAudio.last = this
  }
  play(): Promise<void> {
    return FakeAudio.playResult
  }
}

const audio = (): FakeAudio => {
  if (!FakeAudio.last) throw new Error("no Audio created")
  return FakeAudio.last
}

beforeEach(() => {
  FakeAudio.last = null
  FakeAudio.playResult = Promise.resolve()
  vi.stubGlobal("Audio", FakeAudio)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("playVoicePreview", () => {
  it("ended → onEnd with no error, once", async () => {
    const onEnd = vi.fn()
    playVoicePreview("https://cdn/a.m4a", onEnd)
    await Promise.resolve()
    audio().onended?.()
    audio().onended?.()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith(undefined)
  })

  it("stopped → pauses, clears the source, onEnd with no error", () => {
    const onEnd = vi.fn()
    const stop = playVoicePreview("https://cdn/a.m4a", onEnd)
    stop()
    expect(audio().pause).toHaveBeenCalled()
    expect(audio().src).toBe("")
    expect(onEnd).toHaveBeenCalledWith(undefined)
  })

  it("media error → onEnd with its kind and message", () => {
    const onEnd = vi.fn()
    playVoicePreview("https://cdn/a.m4a", onEnd)
    audio().error = { code: 4, message: "MEDIA_ELEMENT_ERROR: Format error" }
    audio().onerror?.()
    expect(onEnd).toHaveBeenCalledWith("unsupported source: MEDIA_ELEMENT_ERROR: Format error")
    expect(console.warn).toHaveBeenCalled()
  })

  it("rejected play() → onEnd with the rejection", async () => {
    FakeAudio.playResult = Promise.reject(new DOMException("denied", "NotAllowedError"))
    const onEnd = vi.fn()
    playVoicePreview("https://cdn/a.m4a", onEnd)
    await new Promise((r) => setTimeout(r, 0))
    expect(onEnd).toHaveBeenCalledWith("NotAllowedError: denied")
  })
})
