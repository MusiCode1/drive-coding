/**
 * audio-stream.ts — תור אודיו מבוסס MediaSource.
 *
 * כל מקטע (segment) מקבל אלמנט <audio> משלו + צמד MediaSource.
 * פשוט ויציב: ללא הסיבוכיות של single-SourceBuffer ב-sequence-mode.
 *
 * ביקורת MED-6: פסק זמן של 5 שניות על sourceopen כדי למנוע תקיעה אינסופית.
 * ביקורת MIN-5: אם הזרם (stream) נקטע, state="cancelled", והקריאה play() נדחית →
 *   ה-Player מתקדם למקטע הבא (מדלג).
 *
 * הערה: MediaSource אינו זמין ב-happy-dom (סביבת טסטים).
 * טסטים שבודקים את המחלקה הזו חייבים לעשות mock ל-MediaSource או לדלג.
 */

export type AudioSegmentState = "loading" | "ready" | "playing" | "ended" | "cancelled"

export type AudioSegment = {
  segmentId: string
  audio: HTMLAudioElement
  mediaSource: MediaSource
  sourceBuffer: SourceBuffer | null
  abortController: AbortController
  state: AudioSegmentState
  // ─── slice 22: provenance (metadata בלבד — אין צרכן ב-slice זה) ───
  messageId?: string | null
  textHash?: string
}

const SOURCEOPEN_TIMEOUT_MS = 5000

export class AudioStream {
  #segments = new Map<string, AudioSegment>()
  #current: AudioSegment | null = null

  /**
   * מכין מקטע מתוך זרם התגובה (fetch response stream).
   * אסינכרוני; חוזר ברגע ש-MediaSource sourceopen מופעל (אלמנט האודיו מחובר).
   * צריכת הזרם נמשכת ברקע.
   * ביקורת MED-6: פסק זמן של 5 שניות על sourceopen.
   */
  async prepareSegment(
    segmentId: string,
    stream: ReadableStream<Uint8Array>,
    ac: AbortController,
    provenance?: { messageId: string | null; textHash: string },  // slice 22: provenance
  ): Promise<void> {
    const audio = new Audio()
    const mediaSource = new MediaSource()
    audio.src = URL.createObjectURL(mediaSource)

    const seg: AudioSegment = {
      segmentId,
      audio,
      mediaSource,
      sourceBuffer: null,
      abortController: ac,
      state: "loading",
      messageId: provenance?.messageId,
      textHash: provenance?.textHash,
    }
    this.#segments.set(segmentId, seg)

    // ביקורת MED-6: פסק זמן על sourceopen (5 שניות)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`sourceopen timeout for segment ${segmentId}`))
      }, SOURCEOPEN_TIMEOUT_MS)

      // בדוק אם כבר פתוח (הגנה מפני מרוץ תהליכים - race guard)
      if (mediaSource.readyState === "open") {
        clearTimeout(timer)
        seg.sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg")
        resolve()
        return
      }

      mediaSource.addEventListener(
        "sourceopen",
        () => {
          clearTimeout(timer)
          try {
            seg.sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg")
          } catch (e) {
            reject(e)
            return
          }
          resolve()
        },
        { once: true },
      )
    }).catch((e) => {
      seg.state = "cancelled"
      throw e
    })

    // צרוך את הזרם ברקע, וצרף ל-SourceBuffer
    ;(async () => {
      const reader = stream.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (seg.state === "cancelled") break
          if (seg.sourceBuffer && value) {
            await this.#appendBuffer(seg.sourceBuffer, value)
          }
        }
        if (seg.state !== "cancelled" && mediaSource.readyState === "open") {
          mediaSource.endOfStream()
          seg.state = "ready"
        }
      } catch (_e) {
        // ביקורת MIN-5: הזרם נקטע — סמן כמבוטל כדי ש-play() יידחה → דילוג
        if (seg.state !== "cancelled") {
          seg.state = "cancelled"
        }
      }
    })().catch(() => {})
  }

  /**
   * מנגן מקטע. ממתין אם עדיין בטעינה (דוגם עד שמוכן או מבוטל).
   * ביקורת MIN-5: אם המקטע בוטל, דוחה את ההבטחה (rejects) → ה-Player מדלג לבא.
   */
  async play(segmentId: string): Promise<void> {
    const seg = this.#segments.get(segmentId)
    if (!seg) throw new Error(`no segment ${segmentId}`)

    // השהה את המקטע הקודם אם עוברים למקטע אחר
    if (this.#current && this.#current.segmentId !== segmentId) {
      this.#current.audio.pause()
    }
    this.#current = seg

    // המתן עד שהמקטע יהיה מוכן או יבוטל
    if (seg.state === "loading") {
      await this.#waitForReady(seg)
    }

    // ביקורת MIN-5: המקטע מבוטל → reject, ה-Player ידלג
    if (seg.state === "cancelled") {
      throw new Error(`segment ${segmentId} was cancelled`)
    }

    seg.state = "playing"
    return new Promise((resolve, reject) => {
      seg.audio.addEventListener(
        "ended",
        () => {
          seg.state = "ended"
          resolve()
        },
        { once: true },
      )
      seg.audio.addEventListener("error", reject, { once: true })
      seg.audio.play().catch(reject)
    })
  }

  /** ביטול מקטע — מבטל את ה-fetch, משהה את האודיו ומנקה. */
  cancel(segmentId: string): void {
    const seg = this.#segments.get(segmentId)
    if (!seg) return
    seg.state = "cancelled"
    seg.abortController.abort()
    seg.audio.pause()
    try {
      URL.revokeObjectURL(seg.audio.src)
    } catch {
      // התעלם
    }
    if (seg.mediaSource.readyState === "open") {
      try {
        seg.mediaSource.endOfStream()
      } catch {
        // התעלם
      }
    }
    this.#segments.delete(segmentId)
    if (this.#current?.segmentId === segmentId) {
      this.#current = null
    }
  }

  /** נקה את כל המקטעים. */
  clear(): void {
    for (const seg of this.#segments.values()) {
      this.cancel(seg.segmentId)
    }
    this.#current = null
  }

  /** צרף chunk ל-SourceBuffer, והמתן ל-updateend. */
  #appendBuffer(sb: SourceBuffer, chunk: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const onEnd = () => {
        sb.removeEventListener("updateend", onEnd)
        resolve()
      }
      sb.addEventListener("updateend", onEnd)
      try {
        // צור עותק פשוט של ArrayBuffer כדי למנוע את השגיאה של Uint8Array<ArrayBufferLike> ב-TypeScript
        const buf = new ArrayBuffer(chunk.byteLength)
        new Uint8Array(buf).set(chunk)
        sb.appendBuffer(buf)
      } catch (e) {
        sb.removeEventListener("updateend", onEnd)
        reject(e)
      }
    })
  }

  /** דגום עד שהמקטע יעבור ממצב "loading" לכל מצב אחר. */
  #waitForReady(seg: AudioSegment): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (seg.state !== "loading") {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
  }
}
