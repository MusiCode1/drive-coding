/**
 * mp3-segment.ts — segment MP3 עם append ל-SharedAudioOutput (MSE משותף).
 *
 * isComplete(): כל בייטי הסגמנט נקלטו ו-append האחרון הסתיים — בלי endOfStream.
 * play(): נפתר על גבול timeupdate, לא על ended של האלמנט.
 * dispose(): abort בלבד — לא revoke/endOfStream/pause.
 */

import type { SharedAudioOutput } from "../shared-audio-output.js"
import type { PlayableSegment } from "./playable-segment.js"

type Mp3State = "loading" | "ready" | "playing" | "ended" | "cancelled"

export class Mp3Segment implements PlayableSegment {
  readonly segmentId: string
  #state: Mp3State = "loading"
  #output: SharedAudioOutput
  #abortController: AbortController | null = null
  #streamDone = false
  #appendDone = false

  constructor(segmentId: string, output: SharedAudioOutput) {
    this.segmentId = segmentId
    this.#output = output
  }

  prepare(stream: ReadableStream<Uint8Array>, ac: AbortController): void {
    this.#abortController = ac
    this.#output.beginMp3Segment(this.segmentId)
    void this.#doPrepare(stream, ac)
  }

  async #doPrepare(stream: ReadableStream<Uint8Array>, ac: AbortController): Promise<void> {
    const reader = stream.getReader()
    try {
      while (true) {
        if (this.#state === "cancelled") break
        if (ac.signal.aborted) break
        const { value, done } = await reader.read()
        if (done) break
        if (!value) break
        if ((this.#state as Mp3State) === "cancelled") break
        await this.#output.appendMp3(value)
      }

      if (this.#state !== "cancelled") {
        this.#streamDone = true
        this.#output.finalizeMp3Segment(this.segmentId)
        this.#appendDone = true
        if (this.#state === "loading") {
          this.#state = "ready"
        }
      }
    } catch {
      if (this.#state !== "cancelled") {
        this.#state = "cancelled"
      }
    } finally {
      reader.releaseLock()
    }
  }

  async play(): Promise<void> {
    await this.#waitForReady()

    if (this.#state === "cancelled") {
      throw new Error(`Mp3Segment ${this.segmentId} was cancelled`)
    }

    this.#state = "playing"
    await this.#output.playSegmentBoundary(this.segmentId)
    this.#state = "ended"
  }

  pause(): void {
    this.#output.pause()
  }

  /** מסמן לא-נוכחי — לא pause על output משותף. */
  stop(): void {
    if (this.#state === "playing") {
      this.#state = "ready"
    }
  }

  resume(): void {
    this.#output.resume()
  }

  isComplete(): boolean {
    return this.#streamDone && this.#appendDone && this.#state !== "cancelled"
  }

  dispose(): void {
    this.#state = "cancelled"
    this.#abortController?.abort()
  }

  #waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.#state !== "loading" || (this.#appendDone && this.#streamDone)) {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
  }
}
