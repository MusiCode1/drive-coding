/**
 * live-audio-sink.ts — gapless PCM playback for Gemini Live secretary audio.
 *
 * Slice: live-secretary, Commit 1.
 */

import { pcmToFloat32, splitInt16LE } from "@drive-coding/core/voice/pcm"

export type LiveAudioSinkOpts = {
  sampleRate?: number
  onPlayingChange?: (playing: boolean) => void
}

export class LiveAudioSink {
  readonly #sampleRate: number
  readonly #onPlayingChange?: (playing: boolean) => void

  #ctx: AudioContext | null = null
  #carry = new Uint8Array(0)
  #nextStartTime = 0
  #activeSources: AudioBufferSourceNode[] = []
  #playing = false

  constructor(opts?: LiveAudioSinkOpts) {
    this.#sampleRate = opts?.sampleRate ?? 24_000
    this.#onPlayingChange = opts?.onPlayingChange
  }

  get isPlaying(): boolean {
    return this.#playing
  }

  enqueue(pcm: Uint8Array): void {
    const ctx = this.#ensureCtx()
    if (ctx.state === "suspended") {
      void ctx.resume()
    }

    const { samples, rest } = splitInt16LE(this.#carry, pcm)
    this.#carry = rest.length > 0 ? new Uint8Array(rest) : new Uint8Array(0)
    if (samples.length === 0) return

    const floats = pcmToFloat32(samples)
    const buf = ctx.createBuffer(1, floats.length, this.#sampleRate)
    // `pcmToFloat32` is typed Float32Array<ArrayBufferLike>; `copyToChannel`
    // demands Float32Array<ArrayBuffer>, because a SharedArrayBuffer-backed view
    // is not valid here. Re-wrapping yields an ArrayBuffer-backed copy and keeps
    // the idiomatic WebAudio call, rather than asserting the union away.
    buf.copyToChannel(new Float32Array(floats), 0)

    const source = ctx.createBufferSource()
    source.buffer = buf
    source.connect(ctx.destination)

    const startAt = Math.max(this.#nextStartTime, ctx.currentTime)
    source.start(startAt)
    this.#nextStartTime = startAt + buf.duration

    this.#activeSources.push(source)
    this.#setPlaying(true)

    source.onended = () => {
      this.#activeSources = this.#activeSources.filter((s) => s !== source)
      if (this.#activeSources.length === 0) {
        this.#setPlaying(false)
      }
    }
  }

  stop(): void {
    for (const source of this.#activeSources) {
      try {
        source.stop()
      } catch {
        /* already stopped */
      }
    }
    this.#activeSources = []
    this.#carry = new Uint8Array(0)
    if (this.#ctx) {
      this.#nextStartTime = this.#ctx.currentTime
    }
    this.#setPlaying(false)
  }

  #ensureCtx(): AudioContext {
    if (!this.#ctx) {
      this.#ctx = new AudioContext({ sampleRate: this.#sampleRate })
      this.#nextStartTime = this.#ctx.currentTime
    }
    return this.#ctx
  }

  #setPlaying(next: boolean): void {
    if (this.#playing === next) return
    this.#playing = next
    this.#onPlayingChange?.(next)
  }
}
