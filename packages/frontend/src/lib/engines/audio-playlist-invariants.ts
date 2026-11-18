/**
 * Playlist invariant checks for tests — messages in English (lint:i18n).
 */
import { compareOrderKey } from "@drive-coding/core/voice/tts-queue"
import { expect, vi } from "vitest"
import type { AudioPlaylist } from "./audio-playlist.svelte"
import type { AudioSink } from "./audio-sink"

type SinkWithBuffer = AudioSink & {
  isComplete?: (id: string) => boolean
  preparedSegments?: Set<string>
  bufferedSegments?: Set<string>
  noteBuffered?: (segmentId: string) => void
}

function noteBufferedSegment(sink: AudioSink, segmentId: string): void {
  const s = sink as SinkWithBuffer
  s.noteBuffered?.(segmentId)
  s.bufferedSegments?.add(segmentId)
  s.preparedSegments?.add(segmentId)
}

function sinkHasBuffer(sink: AudioSink, segmentId: string): boolean {
  const s = sink as SinkWithBuffer
  if (s.isComplete?.(segmentId) === true) return true
  if (s.bufferedSegments?.has(segmentId) === true) return true
  if (s.preparedSegments?.has(segmentId) === true) return true
  return false
}

/** Family A — synchronous, checked after every playlist action. */
export function checkSyncInvariants(playlist: AudioPlaylist, _sink: AudioSink): void {
  // I3: cursor in range
  expect(playlist.cursor).toBeGreaterThanOrEqual(0)
  expect(playlist.cursor).toBeLessThanOrEqual(playlist.items.length)

  // I5: items sorted by compareOrderKey
  for (let i = 1; i < playlist.items.length; i++) {
    const prev = playlist.items[i - 1]
    const cur = playlist.items[i]
    if (prev !== undefined && cur !== undefined) {
      expect(compareOrderKey(prev.orderKey, cur.orderKey)).toBeLessThanOrEqual(0)
    }
  }

  // I6: no duplicate segmentId
  const ids = playlist.items.map((it) => it.segmentId)
  expect(new Set(ids).size).toBe(ids.length)
}

/** Family B — at rest, checked after flush(). */
export function checkRestInvariants(playlist: AudioPlaylist, sink: AudioSink): void {
  // I1: at most one playing item
  const playing = playlist.items.filter((it) => it.state === "playing")
  expect(playing.length).toBeLessThanOrEqual(1)

  // I2: currentSegmentId empty or points at a playing item
  if (playlist.currentSegmentId !== null) {
    const current = playlist.items.find((it) => it.segmentId === playlist.currentSegmentId)
    expect(current?.state).toBe("playing")
  }

  // I4: ready/playing items must have buffer in sink
  for (const item of playlist.items) {
    if (item.state === "ready" || item.state === "playing") {
      expect(sinkHasBuffer(sink, item.segmentId)).toBe(true)
    }
  }
}

export async function flush(playlist: AudioPlaylist, sink: AudioSink): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
  checkRestInvariants(playlist, sink)
}

const WRAPPED_METHODS = [
  "reserve",
  "markError",
  "markAbandoned",
  "next",
  "prev",
  "jumpTo",
  "jumpToBubble",
  "pause",
  "resume",
  "stop",
] as const

type WrappedMethod = (typeof WRAPPED_METHODS)[number]

/** Wrap playlist actions; markReady also records sink buffer for I4. */
export function installSyncInvariantChecks(playlist: AudioPlaylist, sink: AudioSink): void {
  const origMarkReady = playlist.markReady.bind(playlist)
  playlist.markReady = (segmentId: string) => {
    origMarkReady(segmentId)
    noteBufferedSegment(sink, segmentId)
    checkSyncInvariants(playlist, sink)
  }

  for (const name of WRAPPED_METHODS) {
    const original = playlist[name].bind(playlist) as (...args: never[]) => unknown
    ;(playlist as Record<WrappedMethod, (...args: never[]) => unknown>)[name] = (...args: never[]) => {
      const result = original(...args)
      checkSyncInvariants(playlist, sink)
      return result
    }
  }
}
