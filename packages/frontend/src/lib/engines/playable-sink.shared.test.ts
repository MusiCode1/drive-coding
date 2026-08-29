/**
 * playable-sink.shared.test.ts — TDD: segments על SharedAudioOutput (חוזה משאב משותף).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Mp3Segment } from "./segments/mp3-segment.js"
import { PlayableSink } from "./playable-sink.js"
import { SharedAudioOutput } from "./shared-audio-output.js"

type FakeAudio = HTMLAudioElement & { _end(): void }

function makeFakeAudio(): FakeAudio {
  let paused = true
  const listeners = new Map<string, Set<EventListener>>()

  const emit = (type: string) => {
    for (const fn of listeners.get(type) ?? []) {
      fn(new Event(type))
    }
  }

  return {
    src: "",
    get paused() {
      return paused
    },
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

function streamFrom(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      const c = chunks[i]
      if (c === undefined) {
        controller.close()
        return
      }
      i++
      controller.enqueue(c)
    },
  })
}

describe("PlayableSink + SharedAudioOutput contract", () => {
  let fakeAudio: FakeAudio

  beforeEach(() => {
    fakeAudio = makeFakeAudio()
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:seg")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function waitForSegment(seg: Mp3Segment): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (seg.isComplete()) return
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error("segment not complete")
  }

  it("Mp3Segment.play() resolves on audio ended (src-swap)", async () => {
    const output = new SharedAudioOutput(fakeAudio)
    const seg = new Mp3Segment("s0", output)
    const ac = new AbortController()
    seg.prepare(streamFrom([new Uint8Array(3200)]), ac)

    await waitForSegment(seg)
    expect(seg.isComplete()).toBe(true)

    const p = seg.play()
    await Promise.resolve()
    await Promise.resolve()
    fakeAudio._end()
    await p
    expect(fakeAudio.src).toBe("blob:seg")
    expect(fakeAudio.pause).not.toHaveBeenCalled()
  })

  it("cancel does not kill shared output (element survives)", async () => {
    const sink = new PlayableSink()
    const ac = new AbortController()
    await sink.prepareSegment("x", streamFrom([new Uint8Array(1600)]), ac)
    for (let i = 0; i < 100 && !sink.isComplete("x"); i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(sink.isComplete("x")).toBe(true)
    sink.cancel("x")
    expect(sink.debugInfo().prepared).toBe(0)
    await sink.prepareSegment("y", streamFrom([new Uint8Array(1600)]), ac)
    for (let i = 0; i < 100 && !sink.isComplete("y"); i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(sink.isComplete("y")).toBe(true)
  })

  it("isComplete true after blob is ready (no shared MSE)", async () => {
    const sink = new PlayableSink()
    const ac = new AbortController()
    await sink.prepareSegment("z", streamFrom([new Uint8Array(1600)]), ac)
    for (let i = 0; i < 100 && !sink.isComplete("z"); i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(sink.isComplete("z")).toBe(true)
  })
})
