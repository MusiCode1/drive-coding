/**
 * pcm-audio-stream.ts — WebAudio נגן PCM (l16/24kHz, Gemini TTS).
 *
 * מממש AudioSink ליד AudioStream (MP3/MediaSource). לא תחליף — sibling.
 * RoutingAudioSink (routing-audio-sink.ts) מחליט מי מהם לשמש לפי opts.format.
 *
 * ארכיטקטורה:
 *   - AudioContext אחד למופע (משותף לכל segments); resume() ב-play() (gesture-gated).
 *   - prepareSegment: צורך ReadableStream ברקע → splitInt16LE → pcmToFloat32 → AudioBuffer.
 *     כל chunk → AudioBuffer נפרד (לא מחכה לכל ה-stream).
 *   - play: תזמון gap-less — #nextStartTime cursor. כל buffer.start(#nextStartTime),
 *     #nextStartTime += buf.duration. Promise resolves ב-onended של ה-source האחרון.
 *   - cancel: abort + source.stop() לכל הפעילים.
 *
 * WebAudio לא רץ ב-happy-dom → אין unit test.
 * אימות חי ע"י calev (phase) אחרי Commit 4.
 *
 * HTTPS / secure-context: AudioContext זמין ב-localhost ובכל HTTPS origin.
 * voice-mode כבר מתחיל מ-user gesture → resume() יצליח.
 */

import { pcmToFloat32, splitInt16LE } from "@drive-coding/core/voice/pcm"
import type { AudioSink, SegmentOpts } from "./audio-sink"

const SAMPLE_RATE = 24000

type PcmSegmentState = "loading" | "ready" | "playing" | "ended" | "cancelled"

type PcmSegment = {
  segmentId: string
  state: PcmSegmentState
  abortController: AbortController
  /** רשימת AudioBuffers שהוכנו (chunk פר-item) — ממולאת ב-prepareSegment */
  buffers: AudioBuffer[]
  /** sources פעילים (AudioBufferSourceNode) — למעקב לביטול */
  activeSources: AudioBufferSourceNode[]
  /** האם הזרם הסתיים (כל ה-chunks נקלטו) */
  streamDone: boolean
}

export class PcmAudioStream implements AudioSink {
  #ctx: AudioContext | null = null
  #segments = new Map<string, PcmSegment>()
  /** Cursor: הזמן ב-AudioContext שבו ה-buffer הבא יתחיל לנגן */
  #nextStartTime = 0

  #getCtx(): AudioContext {
    if (!this.#ctx) {
      this.#ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    }
    return this.#ctx
  }

  /**
   * מכין segment: צורך stream ברקע (splitInt16LE → pcmToFloat32 → AudioBuffer).
   * כל chunk אודיו נצרף ל-seg.buffers בזמן ניגון.
   * חוזר מיד (לא ממתין לסיום ה-stream).
   */
  async prepareSegment(
    segmentId: string,
    stream: ReadableStream<Uint8Array>,
    ac: AbortController,
    _opts?: SegmentOpts,
  ): Promise<void> {
    const ctx = this.#getCtx()

    const seg: PcmSegment = {
      segmentId,
      state: "loading",
      abortController: ac,
      buffers: [],
      activeSources: [],
      streamDone: false,
    }
    this.#segments.set(segmentId, seg)

    // צריכת stream ברקע (לא await כאן — חוזרים מיד)
    void this.#consumeStream(ctx, seg, stream)
  }

  async #consumeStream(
    ctx: AudioContext,
    seg: PcmSegment,
    stream: ReadableStream<Uint8Array>,
  ): Promise<void> {
    const reader = stream.getReader()
    let carry: Uint8Array = new Uint8Array(0)
    try {
      while (true) {
        if ((seg.state as string) === "cancelled") break
        const { value, done } = await reader.read()
        if (done) break
        if (!value) break
        if ((seg.state as string) === "cancelled") break

        // פיצול PCM ל-samples עם carry לטיפול בגבולות אי-זוגיים
        const { samples, rest } = splitInt16LE(carry, value)
        // rest מ-splitInt16LE הוא Uint8Array<ArrayBufferLike> — העתק ל-ArrayBuffer
        carry = rest.length > 0 ? new Uint8Array(rest) : new Uint8Array(0)

        if (samples.length > 0) {
          const floats = pcmToFloat32(samples)
          // copyToChannel מצפה ל-Float32Array<ArrayBuffer> — העתק מפורש
          const floatFixed = new Float32Array(floats)
          const buf = ctx.createBuffer(1, floatFixed.length, SAMPLE_RATE)
          buf.copyToChannel(floatFixed, 0)
          seg.buffers.push(buf)
        }
      }

      // flush carry — אם נשאר בייט בודד (אמור להיות נדיר)
      if (carry.length > 0 && seg.state !== "cancelled") {
        // פד ל-2 בייטים (l16 = זוגי תמיד)
        const firstByte = carry[0]
        const padded = new Uint8Array([firstByte !== undefined ? firstByte : 0, 0])
        const { samples } = splitInt16LE(new Uint8Array(0), padded)
        if (samples.length > 0) {
          const floats = pcmToFloat32(samples)
          const floatFixed = new Float32Array(floats)
          const buf = ctx.createBuffer(1, floatFixed.length, SAMPLE_RATE)
          buf.copyToChannel(floatFixed, 0)
          seg.buffers.push(buf)
        }
      }
    } catch {
      // זרם נקטע — segment יסומן cancelled ב-cancel() או ישאר loading
      if (seg.state === "loading") seg.state = "cancelled"
    } finally {
      reader.releaseLock()
    }

    if (seg.state !== "cancelled") {
      seg.streamDone = true
      if (seg.state === "loading") seg.state = "ready"
    }
  }

  /**
   * מנגן segment gap-less.
   * ממתין עד ש-state !== "loading" (stream מתמלא ברקע).
   * gap-less: #nextStartTime cursor — כל buffer מתוזמן מיד אחרי הקודם.
   */
  async play(segmentId: string): Promise<void> {
    const seg = this.#segments.get(segmentId)
    if (!seg) throw new Error(`PcmAudioStream: no segment ${segmentId}`)

    const ctx = this.#getCtx()

    // resume (gesture-gated: voice-mode כבר post-gesture)
    if (ctx.state === "suspended") {
      await ctx.resume()
    }

    // המתן עד ש-buffers מתחילים להגיע (חלק מהם יגיעו ברקע)
    await this.#waitForSomeData(seg)

    if (seg.state === "cancelled") {
      throw new Error(`PcmAudioStream: segment ${segmentId} was cancelled`)
    }

    seg.state = "playing"

    // אתחל cursor אם זה הניגון הראשון
    if (this.#nextStartTime < ctx.currentTime) {
      this.#nextStartTime = ctx.currentTime
    }

    // Promise שמסיים כשכל ה-sources נגנו
    return new Promise<void>((resolve, reject) => {
      let scheduledCount = 0
      let finishedCount = 0
      let done = false

      const scheduleNext = () => {
        if (seg.state === "cancelled") {
          if (!done) {
            done = true
            reject(new Error("cancelled"))
          }
          return
        }

        // תזמן כל buffer שממתין
        const toSchedule = seg.buffers.splice(0)
        for (const buf of toSchedule) {
          const source = ctx.createBufferSource()
          source.buffer = buf
          source.connect(ctx.destination)
          source.start(this.#nextStartTime)
          this.#nextStartTime += buf.duration
          scheduledCount++
          seg.activeSources.push(source)
          source.onended = () => {
            seg.activeSources = seg.activeSources.filter((s) => s !== source)
            finishedCount++
            if (finishedCount >= scheduledCount && seg.streamDone) {
              if (!done) {
                done = true
                seg.state = "ended"
                resolve()
              }
            } else if (!seg.streamDone) {
              // עוד chunks מגיעים — בדוק שוב
              scheduleNext()
            }
          }
        }

        // אם ה-stream עדיין לא הסתיים, תזמן poll קצר
        if (!seg.streamDone && toSchedule.length === 0) {
          setTimeout(scheduleNext, 20)
        } else if (seg.streamDone && toSchedule.length === 0 && scheduledCount === 0) {
          // segment ריק (stream ריק)
          if (!done) {
            done = true
            seg.state = "ended"
            resolve()
          }
        } else if (seg.streamDone && finishedCount >= scheduledCount) {
          if (!done) {
            done = true
            seg.state = "ended"
            resolve()
          }
        }
      }

      scheduleNext()
    })
  }

  /** ממתין עד ש-segment יצא ממצב loading (מספיק buffers, או cancelled) */
  #waitForSomeData(seg: PcmSegment): Promise<void> {
    return new Promise<void>((resolve) => {
      const check = () => {
        if (seg.state !== "loading" || seg.buffers.length > 0) {
          resolve()
        } else {
          setTimeout(check, 20)
        }
      }
      check()
    })
  }

  /** ביטול segment */
  cancel(segmentId: string): void {
    const seg = this.#segments.get(segmentId)
    if (!seg) return
    seg.state = "cancelled"
    seg.abortController.abort()
    for (const source of seg.activeSources) {
      try {
        source.stop()
      } catch {
        /* התעלם */
      }
    }
    seg.activeSources = []
    this.#segments.delete(segmentId)
  }

  /** ביטול כל ה-segments */
  clear(): void {
    for (const segmentId of [...this.#segments.keys()]) {
      this.cancel(segmentId)
    }
    // אפס cursor
    this.#nextStartTime = 0
  }
}
