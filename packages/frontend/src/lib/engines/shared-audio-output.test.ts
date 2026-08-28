/**
 * shared-audio-output.test.ts — TDD: אלמנט יחיד, append, boundary play, dispose-safe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SharedAudioOutput } from "./shared-audio-output.js"

/** Fake SourceBuffer עם updateend סינכרוני. */
function makeSourceBuffer(): SourceBuffer {
  const listeners = new Map<string, Set<EventListener>>()
  return {
    appendBuffer: vi.fn(() => {
      queueMicrotask(() => {
        for (const fn of listeners.get("updateend") ?? []) {
          fn(new Event("updateend"))
        }
      })
    }),
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn)
    },
  } as unknown as SourceBuffer
}

function makeMediaSource(sb: SourceBuffer): MediaSource {
  const listeners = new Map<string, Set<EventListener>>()
  const ms: MediaSource = {
    readyState: "closed" as ReadyState,
    addSourceBuffer: vi.fn(() => sb),
    endOfStream: vi.fn(() => {
      ;(ms as { readyState: ReadyState }).readyState = "ended"
    }),
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
      if (type === "sourceopen") {
        ;(ms as { readyState: ReadyState }).readyState = "open"
        queueMicrotask(() => fn(new Event("sourceopen")))
      }
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn)
    },
  } as unknown as MediaSource
  return ms
}

type FakeAudio = HTMLAudioElement & { _advanceTo(t: number): void; _end?(): void }

function makeFakeAudio(): FakeAudio {
  let currentTime = 0
  let paused = true
  const listeners = new Map<string, Set<EventListener>>()

  const emit = (type: string) => {
    for (const fn of listeners.get(type) ?? []) {
      fn(new Event(type))
    }
  }

  return {
    get currentTime() {
      return currentTime
    },
    set currentTime(v: number) {
      currentTime = v
    },
    get paused() {
      return paused
    },
    src: "",
    play: vi.fn(async () => {
      paused = false
    }),
    pause: vi.fn(() => {
      paused = true
    }),
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn)
    },
    _advanceTo(t: number) {
      currentTime = t
      emit("timeupdate")
    },
    _end() {
      paused = true
      emit("ended")
    },
  } as unknown as FakeAudio
}

describe("SharedAudioOutput", () => {
  let sb: SourceBuffer
  let fakeAudio: FakeAudio
  let output: SharedAudioOutput

  beforeEach(() => {
    sb = makeSourceBuffer()
    fakeAudio = makeFakeAudio()

    vi.stubGlobal(
      "MediaSource",
      class MockMediaSource {
        constructor() {
          return makeMediaSource(sb)
        }
      },
    )
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    })

    output = new SharedAudioOutput(fakeAudio)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("creates exactly one audio element (reused across plays)", async () => {
    expect(output.audio).toBe(fakeAudio)

    output.beginMp3Segment("s0")
    await output.appendMp3(new Uint8Array(1600))
    output.finalizeMp3Segment("s0")

    output.beginMp3Segment("s1")
    await output.appendMp3(new Uint8Array(1600))
    output.finalizeMp3Segment("s1")

    const p0 = output.playSegmentBoundary("s0")
    fakeAudio._advanceTo(output.endOf("s0") ?? 0)
    await p0

    const p1 = output.playSegmentBoundary("s1")
    fakeAudio._advanceTo(output.endOf("s1") ?? 0)
    await p1

    expect(fakeAudio.play).toHaveBeenCalled()
    expect(output.audio).toBe(fakeAudio)
  })

  it("playSegmentBoundary resolves on timeupdate, not ended", async () => {
    output.beginMp3Segment("seg")
    await output.appendMp3(new Uint8Array(3200))
    output.finalizeMp3Segment("seg")

    let resolved = false
    const p = output.playSegmentBoundary("seg").then(() => {
      resolved = true
    })

    expect(resolved).toBe(false)
    fakeAudio._end?.()
    await Promise.resolve()
    expect(resolved).toBe(false)

    fakeAudio._advanceTo(output.endOf("seg") ?? 0)
    await p
    expect(resolved).toBe(true)
  })

  it("reset keeps the same audio element", () => {
    const el = output.audio
    output.reset()
    expect(output.audio).toBe(el)
  })

  it("markEndOfStream does not destroy the audio element", () => {
    output.markEndOfStream()
    expect(output.audio).toBe(fakeAudio)
    expect(fakeAudio.pause).not.toHaveBeenCalled()
  })

  it("segment finalize does not revoke URL or endOfStream the shared element", async () => {
    output.beginMp3Segment("a")
    await output.appendMp3(new Uint8Array(800))
    output.finalizeMp3Segment("a")

    expect(output.startOf("a")).toBeDefined()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })
})
