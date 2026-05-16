/**
 * AudioQueue — plays mp3 chunks in sequence.
 * Each chunk arrives as base64 string and is played via HTMLAudioElement.
 * When one ends, the next starts automatically.
 *
 * Slice 7 fix: tracks lastPlayed for replay-last feature.
 */
export class AudioQueue {
  private queue: HTMLAudioElement[] = []
  private playing = false
  private onStateChange?: (playing: boolean) => void
  private lastPlayed: HTMLAudioElement | null = null

  constructor(opts?: { onStateChange?: (playing: boolean) => void }) {
    this.onStateChange = opts?.onStateChange
  }

  enqueue(mp3Base64: string): void {
    const audio = new Audio(`data:audio/mp3;base64,${mp3Base64}`)
    audio.addEventListener("ended", () => {
      this.playing = false
      this.onStateChange?.(false)
      this.tick()
    })
    audio.addEventListener("error", (e) => {
      console.error("[audio-queue] playback error", e)
      this.playing = false
      this.onStateChange?.(false)
      this.tick()
    })
    this.queue.push(audio)
    this.tick()
  }

  private tick(): void {
    if (this.playing) return
    const next = this.queue.shift()
    if (!next) return
    this.playing = true
    this.lastPlayed = next
    this.onStateChange?.(true)
    next.play().catch((e) => {
      console.error("[audio-queue] play() failed", e)
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
    this.lastPlayed.play().catch(() => {
      // Autoplay policy may block — silent fail
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
