/**
 * player.ts — sequential segment player on top of AudioStream.
 *
 * Holds a FIFO queue of segment IDs and plays them through `AudioStream.play`
 * one after another. When a segment throws (cancelled / network error) we
 * skip it and continue with the next (MIN-5 behaviour).
 *
 * State is exposed as Svelte 5 `$state` so views can react to "is anything
 * playing right now?" via `player.state === "playing"`.
 */

import type { AudioStream } from "./audio-stream"

export type PlayerState = "idle" | "playing"

export class Player {
  state: PlayerState = $state("idle")
  currentSegmentId: string | null = $state(null)

  #audioStream: AudioStream
  #queue: string[] = []
  #playing = false // re-entrancy guard for #playLoop

  constructor(audioStream: AudioStream) {
    this.#audioStream = audioStream
  }

  /**
   * Append a segment to the playback queue. If the Player is idle, kicks off
   * the play loop. Safe to call from any context.
   */
  addSegment(segmentId: string): void {
    this.#queue.push(segmentId)
    if (this.#playing) return
    void this.#playLoop()
  }

  /**
   * Reserved for slice 10 (recordings replay) — not used in slice 2.
   * Clears the current queue and starts playing from `segmentId`.
   */
  jumpToSegment(segmentId: string): void {
    this.#queue = [segmentId]
    if (this.#playing) {
      // current play() will resolve / reject naturally; the loop will then
      // pick up the new queue contents.
      return
    }
    void this.#playLoop()
  }

  /**
   * Stop playback: pause current, drop queue, cancel every segment we own.
   */
  stop(): void {
    const ids = [...this.#queue]
    if (this.currentSegmentId !== null) ids.push(this.currentSegmentId)
    this.#queue = []
    for (const id of ids) this.#audioStream.cancel(id)
    // The browser may not fire ended/error after pause+revoke; expose idle immediately.
    this.#playing = false
    this.state = "idle"
    this.currentSegmentId = null
  }

  async #playLoop(): Promise<void> {
    this.#playing = true
    this.state = "playing"
    try {
      while (this.#queue.length > 0) {
        const id = this.#queue.shift()
        if (id === undefined) break
        this.currentSegmentId = id
        try {
          await this.#audioStream.play(id)
        } catch (_e) {
          // MIN-5: cancelled / error → skip, continue with next.
        }
      }
    } finally {
      this.#playing = false
      this.state = "idle"
      this.currentSegmentId = null
    }
  }
}
