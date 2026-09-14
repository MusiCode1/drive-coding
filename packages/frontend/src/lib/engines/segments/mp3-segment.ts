/**
 * mp3-segment.ts — משפט MP3 כ-blob, ניגון על SharedAudioOutput (src-swap).
 *
 * isComplete(): כל הבייטים נקלטו וה-blob נוצר.
 * play(): src על האלמנט המשותף, נפתר על ended.
 * dispose(): abort + revoke של ה-blob של הסגמנט הזה — לא pause של האלמנט המשותף.
 */

import type { SharedAudioOutput } from "../shared-audio-output.js"
import type { PlayableSegment } from "./playable-segment.js"

type Mp3State = "loading" | "ready" | "playing" | "ended" | "cancelled"

export class Mp3Segment implements PlayableSegment {
  readonly segmentId: string
  #state: Mp3State = "loading"
  #output: SharedAudioOutput
  #abortController: AbortController | null = null
  #chunks: Uint8Array[] = []
  #blobUrl: string | null = null
  #streamDone = false

  constructor(segmentId: string, output: SharedAudioOutput) {
    this.segmentId = segmentId
    this.#output = output
  }

  prepare(stream: ReadableStream<Uint8Array>, ac: AbortController): void {
    this.#abortController = ac
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
        this.#chunks.push(new Uint8Array(value))
      }

      if (this.#state !== "cancelled") {
        this.#streamDone = true
        // TS 5.7 lib.dom: Uint8Array<ArrayBufferLike> אינו BlobPart (חשש SharedArrayBuffer).
        // הצ'אנקים תמיד ArrayBuffer רגיל (new Uint8Array(value) בשורה 43) → cast בטוח.
        this.#blobUrl = URL.createObjectURL(
          new Blob(this.#chunks as BlobPart[], { type: "audio/mpeg" }),
        )
        this.#chunks = []
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

    const url = this.#blobUrl
    if (!url) {
      throw new Error(`Mp3Segment ${this.segmentId} has no blob`)
    }

    this.#state = "playing"
    await this.#output.playBlob(url)
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
    return this.#streamDone && this.#blobUrl !== null && this.#state !== "cancelled"
  }

  dispose(): void {
    this.#state = "cancelled"
    this.#abortController?.abort()
    this.#chunks = []
    if (this.#blobUrl) {
      try {
        URL.revokeObjectURL(this.#blobUrl)
      } catch {
        /* ignore */
      }
      this.#blobUrl = null
    }
  }

  #waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.#state !== "loading" || (this.#streamDone && this.#blobUrl !== null)) {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
  }
}
