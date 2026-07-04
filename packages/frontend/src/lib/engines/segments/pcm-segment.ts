/**
 * pcm-segment.ts — segment WebAudio PCM (l16/24kHz, Gemini TTS).
 *
 * לוגיקה מ-PcmAudioStream, מתואמת ל-PlayableSegment interface.
 *
 * isComplete(): streamDone === true — כל ה-chunks נקלטו.
 *
 * replay: יוצר AudioBufferSourceNode חדשים מה-buffers השמורים בכל play().
 * buffers לעולם לא נמחקים בניגון (splice(0) הוסר) — retained לניגון-מחדש.
 *
 * AudioContext מועבר מ-PlayableSink (instance משותף) — לא נוצר כאן.
 */

import { pcmToFloat32, splitInt16LE } from "@drive-coding/core/voice/pcm"
import type { PlayableSegment } from "./playable-segment"

const SAMPLE_RATE = 24000

type PcmState = "loading" | "ready" | "playing" | "ended" | "cancelled"

export class PcmSegment implements PlayableSegment {
  readonly segmentId: string
  #state: PcmState = "loading"
  #ctx: AudioContext
  /** AudioBuffers מפוענחים — retained לניגון-מחדש (לא splice). */
  #buffers: AudioBuffer[] = []
  /** Cursor: זמן ה-AudioContext לתזמון gap-less (לפי ה-ctx שמחוץ). */
  #nextStartTime = 0
  #streamDone = false
  #activeSources: AudioBufferSourceNode[] = []
  #abortController: AbortController | null = null
  // stop-requested flag: set by stop() before stopping sources.
  // scheduleNext checks this to avoid scheduling new buffers after stop().
  #stopRequested = false

  constructor(segmentId: string, ctx: AudioContext) {
    this.segmentId = segmentId
    this.#ctx = ctx
  }

  /** מכין: צורך stream ברקע (splitInt16LE → pcmToFloat32 → AudioBuffer). */
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
        // #state עשוי להשתנה ל-"cancelled" מ-dispose() בזמן ה-await (task אחר).
        // cast שובר narrowing שגוי של TS שגורר את הבדיקה שלפני ה-await.
        if ((this.#state as PcmState) === "cancelled") break

        const { samples, rest } = splitInt16LE(carry, value)
        carry = rest.length > 0 ? new Uint8Array(rest) : new Uint8Array(0)

        if (samples.length > 0) {
          const floats = pcmToFloat32(samples)
          const floatFixed = new Float32Array(floats)
          const buf = this.#ctx.createBuffer(1, floatFixed.length, SAMPLE_RATE)
          buf.copyToChannel(floatFixed, 0)
          // retained — לא splice
          this.#buffers.push(buf)
        }
      }

      // flush carry
      if (carry.length > 0 && this.#state !== "cancelled") {
        const firstByte = carry[0]
        const padded = new Uint8Array([firstByte !== undefined ? firstByte : 0, 0])
        const { samples } = splitInt16LE(new Uint8Array(0), padded)
        if (samples.length > 0) {
          const floats = pcmToFloat32(samples)
          const floatFixed = new Float32Array(floats)
          const buf = this.#ctx.createBuffer(1, floatFixed.length, SAMPLE_RATE)
          buf.copyToChannel(floatFixed, 0)
          this.#buffers.push(buf)
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

  /**
   * מנגן gap-less. ניתן לקרוא שוב (replay: יוצר sources חדשים מהמערך השמור).
   * #nextStartTime מאותחל ל-ctx.currentTime בכל קריאה → אין drift בין replays.
   */
  async play(): Promise<void> {
    // reset stop flag at the start of each play (replay-safe)
    this.#stopRequested = false

    // resume (gesture-gated)
    if (this.#ctx.state === "suspended") {
      await this.#ctx.resume()
    }

    await this.#waitForSomeData()

    if (this.#state === "cancelled") {
      throw new Error(`PcmSegment ${this.segmentId} was cancelled`)
    }

    this.#state = "playing"

    // אפס cursor ל-ctx.currentTime בכל play (replay-safe, אין drift)
    this.#nextStartTime = this.#ctx.currentTime

    return new Promise<void>((resolve) => {
      let scheduledCount = 0
      let finishedCount = 0
      let done = false

      const scheduleNext = () => {
        // stop was requested — resolve cleanly (stop is a valid completion)
        if (this.#stopRequested) {
          if (!done) {
            done = true
            resolve()
          }
          return
        }

        if (this.#state === "cancelled") {
          if (!done) {
            done = true
            // cancelled resolves too (loop will skip via item.state=skipped/cancelled)
            resolve()
          }
          return
        }

        // תזמן את כל ה-buffers הקיימים (retained — לא splice)
        const toSchedule = [...this.#buffers].slice(scheduledCount)
        for (const buf of toSchedule) {
          const source = this.#ctx.createBufferSource()
          source.buffer = buf
          source.connect(this.#ctx.destination)
          source.start(this.#nextStartTime)
          this.#nextStartTime += buf.duration
          scheduledCount++
          this.#activeSources.push(source)
          source.onended = () => {
            this.#activeSources = this.#activeSources.filter((s) => s !== source)
            finishedCount++
            if (finishedCount >= scheduledCount && this.#streamDone) {
              if (!done) {
                done = true
                this.#state = "ended"
                resolve()
              }
            } else if (!this.#streamDone || finishedCount < scheduledCount) {
              scheduleNext()
            }
          }
        }

        // ה-stream עדיין רץ — poll
        if (!this.#streamDone && toSchedule.length === 0) {
          setTimeout(scheduleNext, 20)
        } else if (this.#streamDone && scheduledCount === 0) {
          // segment ריק
          if (!done) {
            done = true
            this.#state = "ended"
            resolve()
          }
        } else if (this.#streamDone && finishedCount >= scheduledCount) {
          if (!done) {
            done = true
            this.#state = "ended"
            resolve()
          }
        }
      }

      scheduleNext()
    })
  }

  pause(): void {
    if (this.#ctx.state === "running") {
      void this.#ctx.suspend()
    }
  }

  /**
   * עוצר את ה-sources הפעילים **בלי למחוק את ה-buffers** (retain-and-replay).
   * play() הבא ייצור sources חדשים מ-#buffers. streamDone נשמר → isComplete נשאר תקף.
   * Sets #stopRequested BEFORE stopping sources so scheduleNext exits cleanly.
   * After stop(), the play() promise resolves (no deadlock in the loop).
   */
  stop(): void {
    // Set flag first — scheduleNext will see it before scheduling new buffers
    this.#stopRequested = true
    for (const source of this.#activeSources) {
      try {
        source.stop()
      } catch {
        /* התעלם */
      }
    }
    this.#activeSources = []
  }

  resume(): void {
    if (this.#ctx.state === "suspended") {
      void this.#ctx.resume()
    }
  }

  /** isComplete: כל ה-stream התקבל */
  isComplete(): boolean {
    return this.#streamDone
  }

  /**
   * isPlayable: enough data to start playback (≥1 buffer or stream done).
   * Mirrors #waitForSomeData condition — first audio available early.
   */
  isPlayable(): boolean {
    return this.#buffers.length > 0 || this.#streamDone
  }

  /** Teardown מלא — abort + stop sources. */
  dispose(): void {
    this.#state = "cancelled"
    this.#abortController?.abort()
    for (const source of this.#activeSources) {
      try {
        source.stop()
      } catch {
        /* התעלם */
      }
    }
    this.#activeSources = []
    this.#buffers = []
  }

  #waitForSomeData(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.#state !== "loading" || this.#buffers.length > 0) {
          resolve()
        } else {
          setTimeout(check, 20)
        }
      }
      check()
    })
  }
}
