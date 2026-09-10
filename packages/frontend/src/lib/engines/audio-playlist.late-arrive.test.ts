/**
 * audio-playlist.late-arrive.test.ts — late TTS arrival + prev/jump to skipped.
 *
 * Contract (playlist-nav-chrome):
 *   A) late markReady must NOT jump cursor back while N+1 plays; prev replays s1.
 *   B) prev/jump to skipped+isComplete while still skipped → sink.play(s1).
 */

import type { OrderKey } from "@drive-coding/core/voice/tts-queue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "./audio-playlist.svelte"
import { flush, installSyncInvariantChecks } from "./audio-playlist-invariants"
import type { AudioSink, SegmentOpts } from "./audio-sink"

type MockSink = AudioSink & {
  playOrder: string[]
  resolvePlay: (segmentId: string) => void
  completedSegments: Set<string>
  bufferedSegments: Set<string>
  isComplete: (id: string) => boolean
  noteBuffered: (segmentId: string) => void
}

function makeMockSink(): MockSink {
  const playOrder: string[] = []
  const playResolvers = new Map<string, () => void>()
  const completedSegments = new Set<string>()
  const bufferedSegments = new Set<string>()

  const resolvePlay = (segmentId: string) => {
    completedSegments.add(segmentId)
    const r = playResolvers.get(segmentId)
    if (r !== undefined) {
      r()
      playResolvers.delete(segmentId)
    }
  }

  return {
    playOrder,
    resolvePlay,
    completedSegments,
    bufferedSegments,
    noteBuffered: (segmentId: string) => {
      bufferedSegments.add(segmentId)
    },
    isComplete: (id: string) => completedSegments.has(id) || bufferedSegments.has(id),
    prepareSegment: async (
      segmentId: string,
      _stream: ReadableStream<Uint8Array>,
      _ac: AbortController,
      _opts?: SegmentOpts,
    ) => {},
    play: (segmentId: string) => {
      playOrder.push(segmentId)
      return new Promise<void>((resolve) => {
        playResolvers.set(segmentId, resolve)
      })
    },
    cancel: () => {},
    clear: () => playResolvers.clear(),
    pause: () => {},
    resume: () => {},
  }
}

const key = (seq: number, segmentIndex = 0): OrderKey => ({ seq, segmentIndex })

const RESERVE_TIMEOUT_MS = 200

async function settle(playlist: AudioPlaylist, sink: MockSink, ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await flush(playlist, sink)
    await Promise.resolve()
  }
}

/** Steps 1–3 shared by both cases: s0 plays, s1 times out → skipped, s2 starts. */
async function runThroughSkip(playlist: AudioPlaylist, sink: MockSink): Promise<void> {
  playlist.reserve("s0", key(0), "bubble-A")
  playlist.reserve("s1", key(1), "bubble-A")
  playlist.reserve("s2", key(2), "bubble-A")

  // s0 + s2 ready immediately; s1 stays reserved
  sink.noteBuffered("s0")
  sink.noteBuffered("s2")
  playlist.markReady("s0")
  playlist.markReady("s2")

  await settle(playlist, sink)
  expect(sink.playOrder).toContain("s0")

  // s0 finishes → cursor on s1 (reserved) → timeout → skipped → s2 plays
  sink.resolvePlay("s0")
  await settle(playlist, sink)
  await vi.advanceTimersByTimeAsync(RESERVE_TIMEOUT_MS + 50)
  await settle(playlist, sink)

  const s1Item = playlist.items.find((it) => it.segmentId === "s1")
  expect(s1Item?.state).toBe("skipped")

  expect(sink.playOrder).toContain("s2")
  expect(playlist.cursor).toBe(2)
}

describe("AudioPlaylist — late arrive (playlist-nav-chrome)", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("case A: late markReady does not jump back; prev replays s1", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: RESERVE_TIMEOUT_MS })
    installSyncInvariantChecks(playlist, sink)

    await runThroughSkip(playlist, sink)

    const playCountBeforeLate = sink.playOrder.filter((id) => id === "s2").length

    // Late arrival: buffer + markReady — must NOT stop s2 or move cursor back
    sink.noteBuffered("s1")
    playlist.markReady("s1")
    await settle(playlist, sink)

    expect(playlist.cursor).toBe(2)
    expect(sink.playOrder.filter((id) => id === "s2").length).toBe(playCountBeforeLate)

    playlist.prev()
    await settle(playlist, sink, 8)

    expect(sink.playOrder).toContain("s1")
  })

  it("case B: prev to skipped+isComplete (buffer only) → play s1 while still skipped", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: RESERVE_TIMEOUT_MS })
    installSyncInvariantChecks(playlist, sink)

    await runThroughSkip(playlist, sink)

    // Buffer arrives but NOT markReady — item stays skipped
    sink.noteBuffered("s1")
    await settle(playlist, sink)

    const s1Item = playlist.items.find((it) => it.segmentId === "s1")
    expect(s1Item?.state).toBe("skipped")

    const playCountBeforePrev = sink.playOrder.length
    playlist.prev()
    await settle(playlist, sink, 8)

    // At nav time item was skipped; replay must still happen via #playLoop skipped branch
    expect(s1Item?.state).not.toBe("ready")
    expect(sink.playOrder.length).toBeGreaterThan(playCountBeforePrev)
    expect(sink.playOrder).toContain("s1")
  })
})
