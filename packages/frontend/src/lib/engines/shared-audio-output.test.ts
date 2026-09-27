/**
 * shared-audio-output.test.ts — אלמנט יחיד, src-swap, dispose-safe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SharedAudioOutput } from "./shared-audio-output.js"

type FakeAudio = HTMLAudioElement & { _end(): void }

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
    _end() {
      paused = true
      emit("ended")
    },
  } as unknown as FakeAudio
}

describe("SharedAudioOutput", () => {
  let fakeAudio: FakeAudio
  let output: SharedAudioOutput

  beforeEach(() => {
    fakeAudio = makeFakeAudio()
    output = new SharedAudioOutput(fakeAudio)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("creates exactly one audio element (reused across plays)", async () => {
    expect(output.audio).toBe(fakeAudio)

    const p0 = output.playBlob("blob:s0")
    expect(fakeAudio.src).toBe("blob:s0")
    fakeAudio._end()
    await p0

    const p1 = output.playBlob("blob:s1")
    expect(fakeAudio.src).toBe("blob:s1")
    fakeAudio._end()
    await p1

    expect(fakeAudio.play).toHaveBeenCalled()
    expect(output.audio).toBe(fakeAudio)
  })

  it("playBlob resolves on ended", async () => {
    let resolved = false
    const p = output.playBlob("blob:seg").then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)
    fakeAudio._end()
    await p
    expect(resolved).toBe(true)
  })

  it("reset keeps the same audio element", () => {
    const el = output.audio
    output.reset()
    expect(output.audio).toBe(el)
  })

  it("second playBlob supersedes the first wait (same element)", async () => {
    const p0 = output.playBlob("blob:a")
    const p1 = output.playBlob("blob:b")
    await p0
    fakeAudio._end()
    await p1
    expect(fakeAudio.src).toBe("blob:b")
    expect(output.audio).toBe(fakeAudio)
  })
})
