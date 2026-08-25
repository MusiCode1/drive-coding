/**
 * mp3-segment.ts — segment MP3 עם MediaSource/HTMLAudioElement.
 *
 * לוגיקה מ-AudioStream, מתואמת ל-PlayableSegment interface.
 *
 * isComplete(): state ∈ {ready, playing, ended} — כלומר endOfStream() נקרא
 * (finding #4: ended אחרי ניגון ראשון הוא עדיין "complete" לניגון-מחדש).
 *
 * replay: audio.currentTime = 0 + audio.play() + האזנה חדשה ל-"ended".
 * revokeObjectURL רק ב-dispose() — לא ב-cancel של ניווט.
 */

import type { PlayableSegment } from "./playable-segment"

type Mp3State = "loading" | "ready" | "playing" | "ended" | "cancelled"

const SOURCEOPEN_TIMEOUT_MS = 5000

export class Mp3Segment implements PlayableSegment {
  readonly segmentId: string
  #state: Mp3State = "loading"
  #audio: HTMLAudioElement
  #mediaSource: MediaSource
  #sourceBuffer: SourceBuffer | null = null
  #abortController: AbortController | null = null
  #objectUrl: string

  constructor(segmentId: string) {
    this.segmentId = segmentId
    this.#audio = new Audio()
    this.#mediaSource = new MediaSource()
    this.#objectUrl = URL.createObjectURL(this.#mediaSource)
    this.#audio.src = this.#objectUrl
  }

  /** מכין את ה-segment מ-stream. אסינכרוני ברקע — חוזר מיד אחרי sourceopen. */
  prepare(stream: ReadableStream<Uint8Array>, ac: AbortController): void {
    this.#abortController = ac
    void this.#doPrepare(stream, ac)
  }

  async #doPrepare(stream: ReadableStream<Uint8Array>, ac: AbortController): Promise<void> {
    // המתן ל-sourceopen
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`sourceopen timeout for segment ${this.segmentId}`))
      }, SOURCEOPEN_TIMEOUT_MS)

      if (this.#mediaSource.readyState === "open") {
        clearTimeout(timer)
        try {
          this.#sourceBuffer = this.#mediaSource.addSourceBuffer("audio/mpeg")
        } catch (e) {
          reject(e)
          return
        }
        resolve()
        return
      }

      this.#mediaSource.addEventListener(
        "sourceopen",
        () => {
          clearTimeout(timer)
          try {
            this.#sourceBuffer = this.#mediaSource.addSourceBuffer("audio/mpeg")
          } catch (e) {
            reject(e)
            return
          }
          resolve()
        },
        { once: true },
      )
    }).catch(() => {
      this.#state = "cancelled"
    })

    if (this.#state === "cancelled") return

    // צרוך stream ברקע
    void this.#consumeStream(stream, ac)
  }

  async #consumeStream(stream: ReadableStream<Uint8Array>, ac: AbortController): Promise<void> {
    const reader = stream.getReader()
    try {
      while (true) {
        if (this.#state === "cancelled") break
        if (ac.signal.aborted) break
        const { value, done } = await reader.read()
        if (done) break
        if (!value) break
        // #state עשוי להשתנה ל-"cancelled" מ-dispose() בזמן ה-await (task אחר).
        // cast שובר narrowing שגוי של TS שגורר את הבדיקה שלפני ה-await.
        if ((this.#state as Mp3State) === "cancelled") break
        const sb = this.#sourceBuffer
        if (sb && value) {
          await this.#appendBuffer(sb, value)
        }
      }
      if (this.#state !== "cancelled" && this.#mediaSource.readyState === "open") {
        this.#mediaSource.endOfStream()
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

  /** מנגן מה-התחלה. ניתן לקרוא שוב (replay: currentTime=0). */
  async play(): Promise<void> {
    // המתן עד שהמקטע מוכן או בוטל
    await this.#waitForReady()

    if (this.#state === "cancelled") {
      throw new Error(`Mp3Segment ${this.segmentId} was cancelled`)
    }

    // replay: אפס מיקום
    this.#audio.currentTime = 0
    this.#state = "playing"

    return new Promise<void>((resolve, reject) => {
      const audio = this.#audio
      const onEnded = () => {
        audio.removeEventListener("error", onError)
        this.#state = "ended"
        resolve()
      }
      const onError = (e: Event) => {
        audio.removeEventListener("ended", onEnded)
        reject(e)
      }
      audio.addEventListener("ended", onEnded, { once: true })
      audio.addEventListener("error", onError, { once: true })
      audio.play().catch(reject)
    })
  }

  pause(): void {
    this.#audio.pause()
  }

  /** עוצר קול, שומר MediaSource/buffer ל-replay (currentTime יאופס ב-play הבא). */
  stop(): void {
    this.#audio.pause()
  }

  resume(): void {
    void this.#audio.play()
  }

  /**
   * isComplete: true כש-state ∈ {ready, playing, ended}.
   * "ended" אחרי ניגון הוא עדיין מוכן ל-replay (finding #4).
   */
  isComplete(): boolean {
    return (
      this.#state === "ready" || this.#state === "playing" || this.#state === "ended"
    )
  }

  /** Teardown מלא — abort + revoke URL. */
  dispose(): void {
    this.#state = "cancelled"
    this.#abortController?.abort()
    this.#audio.pause()
    try {
      URL.revokeObjectURL(this.#objectUrl)
    } catch {
      /* התעלם */
    }
    if (this.#mediaSource.readyState === "open") {
      try {
        this.#mediaSource.endOfStream()
      } catch {
        /* התעלם */
      }
    }
  }

  #appendBuffer(sb: SourceBuffer, chunk: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const onEnd = () => {
        sb.removeEventListener("updateend", onEnd)
        resolve()
      }
      sb.addEventListener("updateend", onEnd)
      try {
        const buf = new ArrayBuffer(chunk.byteLength)
        new Uint8Array(buf).set(chunk)
        sb.appendBuffer(buf)
      } catch (e) {
        sb.removeEventListener("updateend", onEnd)
        reject(e)
      }
    })
  }

  #waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.#state !== "loading") {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
  }
}
