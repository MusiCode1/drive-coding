/**
 * playable-sink.test.ts — Commit 2b: resume() touches #current only.
 */
import { describe, expect, it, vi } from "vitest"
import { PlayableSink, type SegmentFactory } from "./playable-sink"
import type { PlayableSegment } from "./segments/playable-segment"

function makeSeg(id: string): PlayableSegment {
  return {
    prepare: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    isComplete: () => true,
  }
}

describe("PlayableSink.resume()", () => {
  it("resume() calls only the current segment", async () => {
    const seg0 = makeSeg("s0")
    const seg1 = makeSeg("s1")
    const factory: SegmentFactory = (id) => (id === "s0" ? seg0 : seg1)

    const sink = new PlayableSink(factory)
    const stream = new ReadableStream<Uint8Array>()
    const ac = new AbortController()

    await sink.prepareSegment("s0", stream, ac)
    await sink.prepareSegment("s1", stream, ac)
    await sink.play("s0")
    await sink.play("s1")

    sink.resume()

    expect(seg1.resume).toHaveBeenCalledTimes(1)
    expect(seg0.resume).not.toHaveBeenCalled()
  })
})
