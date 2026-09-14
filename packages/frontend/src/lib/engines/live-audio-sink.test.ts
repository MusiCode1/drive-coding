/**
 * live-audio-sink.test.ts — TDD for Live PCM playback sink.
 *
 * Slice: live-secretary, Commit 1.
 */

import { float32ToInt16LE } from "@drive-coding/core/voice/pcm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LiveAudioSink } from "./live-audio-sink"

function makeMockCtx() {
  let currentTime = 0
  const sources: Array<{ stop: ReturnType<typeof vi.fn>; onended?: () => void }> = []

  return {
    state: "running" as AudioContextState,
    get currentTime() {
      return currentTime
    },
    resume: vi.fn(async () => {}),
    createBuffer: vi.fn((_ch: number, length: number, _rate: number) => ({
      length,
      duration: length / 24_000,
      copyToChannel: vi.fn(),
    })),
    destination: {},
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null as AudioBuffer | null,
        stop: vi.fn(),
        connect: vi.fn(),
        onended: undefined as (() => void) | undefined,
        start: vi.fn(),
      }
      sources.push(source)
      return source
    }),
    sources,
    advanceTime(by: number) {
      currentTime += by
    },
    endAllSources() {
      for (const s of sources) s.onended?.()
      sources.length = 0
    },
  }
}

describe("LiveAudioSink", () => {
  let mockCtx: ReturnType<typeof makeMockCtx>
  let MockAudioContext: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockCtx = makeMockCtx()
    MockAudioContext = vi.fn(function (this: typeof mockCtx) {
      return mockCtx
    })
    vi.stubGlobal("AudioContext", MockAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("enqueue schedules audio and sets isPlaying", () => {
    const sink = new LiveAudioSink({ sampleRate: 24_000 })
    const pcm = float32ToInt16LE(new Float32Array([0.5, -0.5]))

    sink.enqueue(pcm)

    expect(MockAudioContext).toHaveBeenCalledWith({ sampleRate: 24_000 })
    expect(mockCtx.createBufferSource).toHaveBeenCalled()
    expect(sink.isPlaying).toBe(true)
  })

  it("stop clears playback and isPlaying", () => {
    const sink = new LiveAudioSink()
    sink.enqueue(float32ToInt16LE(new Float32Array([0.1])))

    sink.stop()

    expect(sink.isPlaying).toBe(false)
    expect(mockCtx.sources[0]?.stop).toHaveBeenCalled()
  })

  it("notifies onPlayingChange when playback starts and ends", () => {
    const onPlayingChange = vi.fn()
    const sink = new LiveAudioSink({ onPlayingChange })

    sink.enqueue(float32ToInt16LE(new Float32Array([0.1])))
    expect(onPlayingChange).toHaveBeenCalledWith(true)

    mockCtx.endAllSources()
    expect(onPlayingChange).toHaveBeenCalledWith(false)
  })

  it("whenIdle resolves immediately if nothing is playing", async () => {
    const sink = new LiveAudioSink()
    await expect(sink.whenIdle()).resolves.toBeUndefined()
  })

  it("whenIdle resolves when the last source ends", async () => {
    const sink = new LiveAudioSink()
    sink.enqueue(float32ToInt16LE(new Float32Array([0.1])))
    let settled = false
    const done = sink.whenIdle().then(() => {
      settled = true
    })
    expect(settled).toBe(false)
    mockCtx.endAllSources()
    await done
    expect(settled).toBe(true)
  })

  it("whenQuiet waits grace then resolves if still idle", async () => {
    vi.useFakeTimers()
    try {
      const sink = new LiveAudioSink()
      let settled = false
      const done = sink.whenQuiet({ graceMs: 400, timeoutMs: 2000 }).then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(399)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await done
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
