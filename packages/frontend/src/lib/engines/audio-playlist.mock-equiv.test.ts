/**
 * Mock vs PlayableSink isComplete equivalence on shared operation sequences.
 */
import type { OrderKey } from "@drive-coding/core/voice/tts-queue"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "./audio-playlist.svelte"
import { PlayableSink, type SegmentFactory } from "./playable-sink"
import type { PlayableSegment } from "./segments/playable-segment"
import type { AudioSink } from "./audio-sink"

const key = (seq: number): OrderKey => ({ seq, segmentIndex: 0 })

type MockSink = AudioSink & {
  completedSegments: Set<string>
  bufferedSegments: Set<string>
  preparedSegments: Set<string>
  noteBuffered: (segmentId: string) => void
  isComplete: (id: string) => boolean
  play: (segmentId: string) => Promise<void>
  cancel: (segmentId: string) => void
}

function makeMockSink(): MockSink {
  const playResolvers = new Map<string, () => void>()
  const completedSegments = new Set<string>()
  const bufferedSegments = new Set<string>()
  const preparedSegments = new Set<string>()

  return {
    completedSegments,
    bufferedSegments,
    preparedSegments,
    noteBuffered: (segmentId: string) => {
      bufferedSegments.add(segmentId)
    },
    isComplete: (id: string) =>
      completedSegments.has(id) || bufferedSegments.has(id) || preparedSegments.has(id),
    prepareSegment: async (segmentId: string) => {
      preparedSegments.add(segmentId)
      bufferedSegments.add(segmentId)
    },
    play: (segmentId: string) =>
      new Promise<void>((resolve) => {
        playResolvers.set(segmentId, resolve)
      }),
    cancel: (segmentId: string) => {
      completedSegments.delete(segmentId)
      bufferedSegments.delete(segmentId)
      preparedSegments.delete(segmentId)
      playResolvers.get(segmentId)?.()
      playResolvers.delete(segmentId)
    },
    clear: () => playResolvers.clear(),
    pause: () => {},
    resume: () => {},
  }
}

function makeFakeSegment(id: string): PlayableSegment {
  let complete = false
  return {
    segmentId: id,
    prepare: () => {
      complete = true
    },
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(() => {
      complete = false
    }),
    isComplete: () => complete,
  }
}

type EquivStep =
  | { op: "reserve"; id: string }
  | { op: "prepare"; id: string }
  | { op: "markReady"; id: string }
  | { op: "play"; id: string }
  | { op: "cancel"; id: string }

const SEQUENCE: EquivStep[] = [
  { op: "reserve", id: "s0" },
  { op: "prepare", id: "s0" },
  { op: "markReady", id: "s0" },
  { op: "reserve", id: "s1" },
  { op: "prepare", id: "s1" },
  { op: "markReady", id: "s1" },
  { op: "play", id: "s0" },
  { op: "cancel", id: "s1" },
  { op: "prepare", id: "s1" },
  { op: "markReady", id: "s1" },
]

function assertIsCompleteParity(mock: MockSink, real: PlayableSink, ids: string[]): void {
  for (const id of ids) {
    expect(mock.isComplete(id)).toBe(real.isComplete(id))
  }
}

describe("mock vs PlayableSink isComplete equivalence", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("agrees on isComplete after each step in a shared sequence", async () => {
    const mockSink = makeMockSink()
    const segments = new Map<string, PlayableSegment>()
    const factory: SegmentFactory = (id) => {
      const existing = segments.get(id)
      if (existing !== undefined) return existing
      const seg = makeFakeSegment(id)
      segments.set(id, seg)
      return seg
    }
    const realSink = new PlayableSink(factory)

    const mockPlaylist = new AudioPlaylist(mockSink, undefined, { reserveTimeoutMs: 5000 })
    const realPlaylist = new AudioPlaylist(realSink, undefined, { reserveTimeoutMs: 5000 })

    const ids: string[] = []
    const stream = new ReadableStream<Uint8Array>()
    const ac = new AbortController()

    for (const step of SEQUENCE) {
      switch (step.op) {
        case "reserve": {
          ids.push(step.id)
          mockPlaylist.reserve(step.id, key(ids.length - 1), "bubble-A")
          realPlaylist.reserve(step.id, key(ids.length - 1), "bubble-A")
          break
        }
        case "prepare": {
          await realSink.prepareSegment(step.id, stream, ac)
          await mockSink.prepareSegment(step.id, stream, ac)
          break
        }
        case "markReady": {
          mockPlaylist.markReady(step.id)
          realPlaylist.markReady(step.id)
          break
        }
        case "play": {
          void mockSink.play(step.id)
          void realSink.play(step.id)
          mockSink.completedSegments.add(step.id)
          break
        }
        case "cancel": {
          mockSink.cancel(step.id)
          realSink.cancel(step.id)
          break
        }
      }
      assertIsCompleteParity(mockSink, realSink, ids)
    }
  })
})
