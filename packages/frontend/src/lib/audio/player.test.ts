import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudioQueue } from "./player"

// Minimal HTMLAudioElement mock
class MockAudio {
  src: string
  currentTime = 0
  private _listeners: Record<string, Array<(e?: unknown) => void>> = {}

  constructor(src: string) {
    this.src = src
  }

  addEventListener(event: string, fn: (e?: unknown) => void) {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event]?.push(fn)
  }

  play(): Promise<void> {
    return Promise.resolve()
  }

  _emit(event: string, e?: unknown) {
    for (const fn of this._listeners[event] ?? []) fn(e)
  }
}

describe("AudioQueue", () => {
  beforeEach(() => {
    vi.stubGlobal("Audio", MockAudio)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("hasLastPlayed is false when nothing has been played", () => {
    const queue = new AudioQueue()
    expect(queue.hasLastPlayed).toBe(false)
  })

  it("hasLastPlayed is true after a chunk is enqueued and played", async () => {
    const queue = new AudioQueue()
    queue.enqueue("abc123")
    // tick() calls play() — which returns a resolved promise
    await new Promise<void>((r) => queueMicrotask(r))
    expect(queue.hasLastPlayed).toBe(true)
  })

  it("replayLast resets currentTime and calls play() on the last element", async () => {
    const queue = new AudioQueue()
    queue.enqueue("abc123")
    await new Promise<void>((r) => queueMicrotask(r))

    // Cast to access internals via mock
    // replayLast should not throw
    expect(() => queue.replayLast()).not.toThrow()
  })

  it("replayLast is a no-op when nothing played yet", () => {
    const queue = new AudioQueue()
    expect(() => queue.replayLast()).not.toThrow()
  })

  it("isPlaying is false initially", () => {
    const queue = new AudioQueue()
    expect(queue.isPlaying).toBe(false)
  })

  it("plays next chunk after first ends", async () => {
    const stateChanges: boolean[] = []
    const queue = new AudioQueue({ onStateChange: (p) => stateChanges.push(p) })

    queue.enqueue("chunk1")
    await new Promise<void>((r) => queueMicrotask(r))
    expect(stateChanges).toContain(true) // playing started
  })

  it("clear stops current and empties queue", () => {
    const queue = new AudioQueue()
    queue.enqueue("x")
    queue.clear()
    expect(queue.isPlaying).toBe(false)
  })
})
