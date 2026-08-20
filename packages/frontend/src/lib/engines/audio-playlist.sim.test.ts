/**
 * Property-based random simulation over AudioPlaylist operations.
 */
import type { OrderKey } from "@drive-coding/core/voice/tts-queue"
import * as fc from "fast-check"
import { afterEach, beforeEach, describe, it, vi } from "vitest"
import { AudioPlaylist } from "./audio-playlist.svelte"
import {
  checkRestInvariants,
  checkSyncInvariants,
  flush,
  installSyncInvariantChecks,
} from "./audio-playlist-invariants"
import type { AudioSink } from "./audio-sink"

const key = (seq: number, segmentIndex = 0): OrderKey => ({ seq, segmentIndex })

type SimSink = AudioSink & {
  playOrder: string[]
  resolvePlay: (segmentId: string) => void
  preparedSegments: Set<string>
  completedSegments: Set<string>
  bufferedSegments: Set<string>
  noteBuffered: (segmentId: string) => void
  isComplete: (id: string) => boolean
}

function makeSimSink(): SimSink {
  const playOrder: string[] = []
  const playResolvers = new Map<string, () => void>()
  const preparedSegments = new Set<string>()
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
    preparedSegments,
    completedSegments,
    bufferedSegments,
    noteBuffered: (segmentId: string) => {
      bufferedSegments.add(segmentId)
    },
    isComplete: (id: string) => completedSegments.has(id) || bufferedSegments.has(id),
    prepareSegment: async (segmentId: string) => {
      preparedSegments.add(segmentId)
    },
    play: (segmentId: string) => {
      playOrder.push(segmentId)
      return new Promise<void>((resolve) => {
        playResolvers.set(segmentId, resolve)
      })
    },
    cancel: (segmentId: string) => {
      completedSegments.delete(segmentId)
      bufferedSegments.delete(segmentId)
      preparedSegments.delete(segmentId)
      const r = playResolvers.get(segmentId)
      if (r !== undefined) {
        r()
        playResolvers.delete(segmentId)
      }
    },
    clear: () => {
      playResolvers.clear()
    },
    pause: () => {},
    resume: () => {},
  }
}

/** Deterministic command — all randomness comes from fast-check. */
type SimCmd =
  | { op: "reserve"; bubble: number }
  | { op: "markReady"; pick: number }
  | { op: "markError"; pick: number }
  | { op: "next" }
  | { op: "prev" }
  | { op: "jumpTo"; pick: number }
  | { op: "jumpToBubble"; pick: number }
  | { op: "pause" }
  | { op: "resume" }
  | { op: "stop" }
  | { op: "resolvePlay"; pick: number }
  | { op: "flush" }

const CMD_ARBITRARY: fc.Arbitrary<SimCmd> = fc.oneof(
  fc.record({ op: fc.constant("reserve" as const), bubble: fc.integer({ min: 0, max: 3 }) }),
  fc.record({ op: fc.constant("markReady" as const), pick: fc.integer({ min: 0, max: 999 }) }),
  fc.record({ op: fc.constant("markError" as const), pick: fc.integer({ min: 0, max: 999 }) }),
  fc.constant({ op: "next" as const }),
  fc.constant({ op: "prev" as const }),
  fc.record({ op: fc.constant("jumpTo" as const), pick: fc.integer({ min: 0, max: 999 }) }),
  fc.record({ op: fc.constant("jumpToBubble" as const), pick: fc.integer({ min: 0, max: 999 }) }),
  fc.constant({ op: "pause" as const }),
  fc.constant({ op: "resume" as const }),
  fc.constant({ op: "stop" as const }),
  fc.record({ op: fc.constant("resolvePlay" as const), pick: fc.integer({ min: 0, max: 999 }) }),
  fc.constant({ op: "flush" as const }),
)

const SEED = Number(process.env.FC_SEED ?? "42")
const NUM_RUNS = 1000

function pickItem<T>(items: T[], pick: number): T | undefined {
  if (items.length === 0) return undefined
  return items[pick % items.length]
}

function applyCmd(cmd: SimCmd, playlist: AudioPlaylist, sink: SimSink, ctx: { nextSeq: number }): void {
  switch (cmd.op) {
    case "reserve": {
      const id = `sim-${ctx.nextSeq++}`
      playlist.reserve(id, key(ctx.nextSeq), `bubble-${cmd.bubble}`)
      break
    }
    case "markReady": {
      const item = pickItem(playlist.items, cmd.pick)
      if (item !== undefined) playlist.markReady(item.segmentId)
      break
    }
    case "markError": {
      const item = pickItem(playlist.items, cmd.pick)
      if (item !== undefined) playlist.markError(item.segmentId)
      break
    }
    case "next":
      playlist.next()
      break
    case "prev":
      playlist.prev()
      break
    case "jumpTo": {
      if (playlist.items.length === 0) break
      playlist.jumpTo(cmd.pick % playlist.items.length)
      break
    }
    case "jumpToBubble": {
      const bubbles = [...new Set(playlist.items.map((it) => it.bubbleId))]
      const bubble = pickItem(bubbles, cmd.pick)
      if (bubble !== undefined) playlist.jumpToBubble(bubble)
      break
    }
    case "pause":
      playlist.pause()
      break
    case "resume":
      playlist.resume()
      break
    case "stop":
      playlist.stop()
      break
    case "resolvePlay": {
      const pending = sink.playOrder.filter((id) => !sink.completedSegments.has(id))
      const target = pickItem(pending, cmd.pick)
      if (target !== undefined) sink.resolvePlay(target)
      break
    }
    case "flush":
      break
  }
}

async function runSequence(cmds: SimCmd[]): Promise<void> {
  const sink = makeSimSink()
  const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })
  installSyncInvariantChecks(playlist, sink)
  const ctx = { nextSeq: 0 }

  for (const cmd of cmds) {
    applyCmd(cmd, playlist, sink, ctx)
    checkSyncInvariants(playlist, sink)
    if (cmd.op === "flush") {
      await flush(playlist, sink)
    }
  }
  await flush(playlist, sink)
}

describe("AudioPlaylist — random simulation", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("maintains invariants over random operation sequences", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(CMD_ARBITRARY, { minLength: 5, maxLength: 40 }), async (cmds) => {
        await runSequence(cmds)
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    )
  })
})
