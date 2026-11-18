/**
 * pcm-segment.ts — segment PCM (l16/24kHz) → WAV blob על SharedAudioOutput.
 *
 * isComplete(): streamDone === true.
 * play(): עוטף WAV ב-play() אחרי streamDone; נפתר על ended (src-swap).
 * dispose(): abort בלבד — לא revoke על src משותף.
 */

import { pcmToFloat32, splitInt16LE } from "@drive-coding/core/voice/pcm"
import { encodeWav } from "../wake-word/wav.js"
import type { SharedAudioOutput } from "../shared-audio-output.js"
import type { PlayableSegment } from "./playable-segment.js"

const SAMPLE_RATE = 24000

type PcmState = "loading" | "ready" | "playing" | "ended" | "cancelled"

export class PcmSegment implements PlayableSegment {
  readonly segmentId: string
  #state: PcmState = "loading"
  #output: SharedAudioOutput
  #floatFrames: Float32Array[] = []
  #streamDone = false
  #blobUrl: string | null = null
  #abortController: AbortController | null = null

  constructor(segmentId: string, output: SharedAudioOutput) {
    this.segmentId = segmentId
    this.#output = output
  }

  prepare(stream: ReadableStream<Uint8Array>, ac: AbortController): void {
    this.#abortController = ac
    void this.#consumeStream(stream, ac)
  }

  async #consumeStream(stream: ReadableStream<Uint8Array>, ac: AbortController): Promise<void> {
    const reader = stream.getReader()
    let carry: Uint8Array = new Uint8Array(0)
    try {
      while (true) {
        if (this.#state === "cancelled" || ac.signal.aborted) break
        const { value, done } = await reader.read()
        if (done) break
        if (!value) break
        if ((this.#state as PcmState) === "cancelled") break

        const { samples, rest } = splitInt16LE(carry, value)
        carry = rest.length > 0 ? new Uint8Array(rest) : new Uint8Array(0)

        if (samples.length > 0) {
          const floats = pcmToFloat32(samples)
          this.#floatFrames.push(new Float32Array(floats))
        }
      }

      if (carry.length > 0 && this.#state !== "cancelled") {
        const firstByte = carry[0]
        const padded = new Uint8Array([firstByte !== undefined ? firstByte : 0, 0])
        const { samples } = splitInt16LE(new Uint8Array(0), padded)
        if (samples.length > 0) {
          const floats = pcmToFloat32(samples)
          this.#floatFrames.push(new Float32Array(floats))
        }
      }
    } catch {
      if (this.#state === "loading") this.#state = "cancelled"
    } finally {
      reader.releaseLock()
    }

    if (this.#state !== "cancelled") {
      this.#streamDone = true
      if (this.#state === "loading") this.#state = "ready"
    }
  }

  async play(): Promise<void> {
    await this.#waitForStreamDone()

    if (this.#state === "cancelled") {
      throw new Error(`PcmSegment ${this.segmentId} was cancelled`)
    }

    this.#state = "playing"
    const blobUrl = this.#ensureWavBlob()
    await this.#output.playBlob(blobUrl)
    this.#state = "ended"
  }

  pause(): void {
    this.#output.pause()
  }

  stop(): void {
    if (this.#state === "playing") {
      this.#state = "ready"
    }
  }

  resume(): void {
    this.#output.resume()
  }

  isComplete(): boolean {
    return this.#streamDone
  }

  dispose(): void {
    this.#state = "cancelled"
    this.#abortController?.abort()
    this.#floatFrames = []
    // blobUrl נשאר — לא revoke על src משותף
  }

  #ensureWavBlob(): string {
    if (this.#blobUrl) return this.#blobUrl
    const wav = encodeWav(this.#floatFrames, SAMPLE_RATE)
    if (!wav) {
      throw new Error(`PcmSegment ${this.segmentId}: empty WAV`)
    }
    const blob = new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" })
    this.#blobUrl = URL.createObjectURL(blob)
    return this.#blobUrl
  }

  #waitForStreamDone(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.#streamDone || this.#state !== "loading") {
          resolve()
        } else {
          setTimeout(check, 20)
        }
      }
      check()
    })
  }
}
