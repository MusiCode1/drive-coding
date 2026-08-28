/**
 * playable-sink.shared.test.ts — TDD: segments על SharedAudioOutput (חוזה משאב משותף).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Mp3Segment } from "./segments/mp3-segment.js"
import { PlayableSink } from "./playable-sink.js"
import { SharedAudioOutput } from "./shared-audio-output.js"

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

function makeFakeAudio(): HTMLAudioElement {
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
  } as unknown as HTMLAudioElement
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
  let fakeAudio: HTMLAudioElement
  let savedMediaSource: typeof MediaSource

  beforeEach(() => {
    fakeAudio = makeFakeAudio()
    const sb = makeSourceBuffer()
    savedMediaSource = globalThis.MediaSource
    vi.stubGlobal(
      "MediaSource",
      class MockMediaSource {
        constructor() {
          return makeMediaSource(sb)
        }
      },
    )
  })

  afterEach(() => {
    vi.stubGlobal("MediaSource", savedMediaSource)
  })

  async function waitForSegment(seg: Mp3Segment): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (seg.isComplete()) return
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error("segment not complete")
  }

  it("Mp3Segment.play() resolves on boundary without audio ended", async () => {
    const output = new SharedAudioOutput(fakeAudio)
    const seg = new Mp3Segment("s0", output)
    const ac = new AbortController()
    seg.prepare(streamFrom([new Uint8Array(3200)]), ac)

    await waitForSegment(seg)
    expect(seg.isComplete()).toBe(true)

    const p = seg.play()
    await Promise.resolve()
    await Promise.resolve()
    ;(fakeAudio as { _advanceTo(t: number): void })._advanceTo(output.endOf("s0") ?? 0.2)
    await p
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

  it("isComplete true without endOfStream on shared MSE", async () => {
    const sink = new PlayableSink()
    const ac = new AbortController()
    await sink.prepareSegment("z", streamFrom([new Uint8Array(1600)]), ac)
    for (let i = 0; i < 100 && !sink.isComplete("z"); i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(sink.isComplete("z")).toBe(true)
  })
})
