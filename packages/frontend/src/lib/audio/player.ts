/**
 * AudioQueue — plays mp3 chunks in sequence.
 * Each chunk arrives as base64 string and is played via HTMLAudioElement.
 * When one ends, the next starts automatically.
 *
 * Slice 7 fix: tracks lastPlayed for replay-last feature.
 */
import { createLogger } from "$lib/log"

const log = createLogger("fe.audio.player")

export class AudioQueue {
  private queue: HTMLAudioElement[] = []
  private playing = false
  private onStateChange?: (playing: boolean) => void
  private lastPlayed: HTMLAudioElement | null = null

  constructor(opts?: { onStateChange?: (playing: boolean) => void }) {
    this.onStateChange = opts?.onStateChange
  }

  enqueue(mp3Base64: string): void {
    log.debug(
      { bytes: mp3Base64.length, queueLen: this.queue.length, playing: this.playing },
      "enqueue",
    )
    const audio = new Audio(`data:audio/mp3;base64,${mp3Base64}`)
    audio.addEventListener("ended", () => {
      log.debug({}, "tick: ended")
      this.playing = false
      this.onStateChange?.(false)
      this.tick()
    })
    audio.addEventListener("error", (e) => {
      log.warn({ err: e }, "playback error")
      this.playing = false
      this.onStateChange?.(false)
      this.tick()
    })
    this.queue.push(audio)
    this.tick()
  }

  private tick(): void {
    if (this.playing) {
      log.debug({}, "tick: already playing — skip")
      return
    }
    const next = this.queue.shift()
    if (!next) {
      log.debug({}, "tick: queue empty")
      return
    }
    log.debug({ queueLeft: this.queue.length }, "tick: play next")
    this.playing = true
    this.lastPlayed = next
    this.onStateChange?.(true)
    next.play().catch((e) => {
      log.warn({ err: e }, "play() autoplay blocked")
      this.playing = false
      this.onStateChange?.(false)
      this.tick()
    })
  }

  clear(): void {
    this.queue = []
    this.playing = false
    this.onStateChange?.(false)
  }

  /** Replay the last played audio element from the beginning. */
  replayLast(): void {
    if (!this.lastPlayed) return
    this.lastPlayed.currentTime = 0
    this.lastPlayed.play().catch((e) => {
      log.warn({ err: e }, "replay autoplay blocked")
    })
  }

  get isPlaying(): boolean {
    return this.playing
  }

  /** True if at least one audio element has been played. */
  get hasLastPlayed(): boolean {
    return this.lastPlayed !== null
  }
}
