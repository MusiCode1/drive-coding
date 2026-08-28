/**
 * shared-audio-output.ts — בעלים יחיד של HTMLAudioElement לכל TTS.
 *
 * MP3: MediaSource אחד + SourceBuffer — append רציף, endOfStream רק ב-reset/stop.
 * PCM: WAV blob על אותו אלמנט (src-swap).
 */

export type SegmentRange = {
  startTime: number
  endTime: number
}

export type OutputFormat = "mse" | "blob"

const SOURCEOPEN_TIMEOUT_MS = 5000

export class SharedAudioOutput {
  readonly #audio: HTMLAudioElement
  #format: OutputFormat = "mse"
  #mediaSource: MediaSource | null = null
  #sourceBuffer: SourceBuffer | null = null
  #objectUrl: string | null = null
  /** משך מצטבר ב-buffer (שניות) — מעקב ידני לטווחי סגמנט. */
  #bufferedDuration = 0
  #ranges = new Map<string, SegmentRange>()
  /** segment שממתין לסגירת טווח (append בתהליך). */
  #openSegmentId: string | null = null
  #openSegmentStart = 0
  #eofCalled = false
  #mseReady: Promise<void>
  #mseReadyResolve!: () => void
  #mseReadyReject!: (e: unknown) => void

  constructor(audio?: HTMLAudioElement) {
    this.#audio = audio ?? new Audio()
    this.#mseReady = new Promise<void>((resolve, reject) => {
      this.#mseReadyResolve = resolve
      this.#mseReadyReject = reject
    })
    this.#initMse()
  }

  get audio(): HTMLAudioElement {
    return this.#audio
  }

  get format(): OutputFormat {
    return this.#format
  }

  startOf(segmentId: string): number | undefined {
    return this.#ranges.get(segmentId)?.startTime
  }

  endOf(segmentId: string): number | undefined {
    return this.#ranges.get(segmentId)?.endTime
  }

  isInRange(segmentId: string): boolean {
    const range = this.#ranges.get(segmentId)
    if (!range) return false
    const ct = this.#audio.currentTime
    return ct >= range.startTime && ct < range.endTime
  }

  /** מתחיל append לסגמנט MP3 חדש — רושם startTime לפני הבייטים הראשונים. */
  beginMp3Segment(segmentId: string): void {
    if (this.#format !== "mse") {
      throw new Error("beginMp3Segment requires MSE format")
    }
    this.#openSegmentId = segmentId
    this.#openSegmentStart = this.#bufferedDuration
  }

  /** מסיים append לסגמנט — רושם endTime. */
  finalizeMp3Segment(segmentId: string): void {
    if (this.#openSegmentId !== segmentId) return
    this.#ranges.set(segmentId, {
      startTime: this.#openSegmentStart,
      endTime: this.#bufferedDuration,
    })
    this.#openSegmentId = null
  }

  async appendMp3(chunk: Uint8Array): Promise<void> {
    await this.#mseReady
    const sb = this.#sourceBuffer
    if (!sb) throw new Error("SourceBuffer not ready")
    await this.#appendBuffer(sb, chunk)
    // הערכת משך: MP3 ~128kbps → ~16KB/s (גס; מספיק לגבולות סגמנט ב-tests)
    this.#bufferedDuration += chunk.byteLength / 16000
  }

  /**
   * מנגן עד גבול הסגמנט (timeupdate). לא מחכה ל-ended של האלמנט
   * אלא אם endOfStream כבר נקרא (סוף תור).
   */
  async playSegmentBoundary(segmentId: string): Promise<void> {
    const range = this.#ranges.get(segmentId)
    if (!range) {
      throw new Error(`SharedAudioOutput: no range for segment ${segmentId}`)
    }

    const { startTime, endTime } = range
    const ct = this.#audio.currentTime

    if (ct < startTime - 0.05 || ct >= endTime) {
      this.#audio.currentTime = startTime
    }

    if (this.#audio.paused) {
      await this.#audio.play()
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.#audio.removeEventListener("timeupdate", onTimeUpdate)
        this.#audio.removeEventListener("ended", onEnded)
        this.#audio.removeEventListener("error", onError)
      }
      const onTimeUpdate = () => {
        if (this.#audio.currentTime >= endTime - 0.01) {
          cleanup()
          resolve()
        }
      }
      const onEnded = () => {
        if (this.#eofCalled) {
          cleanup()
          resolve()
        }
      }
      const onError = (e: Event) => {
        cleanup()
        reject(e)
      }

      this.#audio.addEventListener("timeupdate", onTimeUpdate)
      this.#audio.addEventListener("ended", onEnded)
      this.#audio.addEventListener("error", onError, { once: true })

      // בדיקה מיידית — segment קצר מאוד
      if (this.#audio.currentTime >= endTime - 0.01) {
        cleanup()
        resolve()
      }
    })
  }

  /** PCM: מחליף src ל-blob URL ומנגן עד ended. */
  async playBlob(blobUrl: string): Promise<void> {
    this.#format = "blob"
    this.#audio.src = blobUrl

    return new Promise<void>((resolve, reject) => {
      const onEnded = () => {
        this.#audio.removeEventListener("error", onError)
        resolve()
      }
      const onError = (e: Event) => {
        this.#audio.removeEventListener("ended", onEnded)
        reject(e)
      }
      this.#audio.addEventListener("ended", onEnded, { once: true })
      this.#audio.addEventListener("error", onError, { once: true })
      this.#audio.play().catch(reject)
    })
  }

  pause(): void {
    this.#audio.pause()
  }

  resume(): void {
    void this.#audio.play()
  }

  /** endOfStream על MSE פתוח — רק כשהפלייליסט עוצר / idle-park. */
  markEndOfStream(): void {
    this.#eofCalled = true
    if (this.#mediaSource?.readyState === "open") {
      try {
        this.#mediaSource.endOfStream()
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * איפוס מלא: pause + endOfStream + MSE חדש על **אותו** אלמנט.
   * נקרא מ-PlayableSink.clear() / stop().
   */
  reset(): void {
    this.#audio.pause()
    this.markEndOfStream()
    this.#ranges.clear()
    this.#bufferedDuration = 0
    this.#openSegmentId = null
    this.#eofCalled = false
    this.#teardownMse()
    this.#initMse()
  }

  /** החלפת פורמט באמצע תור (mp3↔pcm). */
  switchFormat(format: OutputFormat): void {
    if (format === this.#format) return
    this.#audio.pause()
    if (this.#format === "mse" && this.#mediaSource?.readyState === "open") {
      try {
        this.#mediaSource.endOfStream()
      } catch {
        /* ignore */
      }
    }
    this.#teardownMse()
    this.#ranges.clear()
    this.#bufferedDuration = 0
    this.#openSegmentId = null
    this.#eofCalled = false
    this.#format = format
    if (format === "mse") {
      this.#initMse()
    }
  }

  #initMse(): void {
    this.#format = "mse"
    this.#mediaSource = new MediaSource()
    this.#objectUrl = URL.createObjectURL(this.#mediaSource)
    this.#audio.src = this.#objectUrl

    const timer = setTimeout(() => {
      this.#mseReadyReject(new Error("sourceopen timeout"))
    }, SOURCEOPEN_TIMEOUT_MS)

    const onOpen = () => {
      clearTimeout(timer)
      try {
        this.#sourceBuffer = this.#mediaSource!.addSourceBuffer("audio/mpeg")
        this.#mseReadyResolve()
      } catch (e) {
        this.#mseReadyReject(e)
      }
    }

    if (this.#mediaSource.readyState === "open") {
      onOpen()
    } else {
      this.#mediaSource.addEventListener("sourceopen", onOpen, { once: true })
    }
  }

  #teardownMse(): void {
    if (this.#objectUrl) {
      try {
        URL.revokeObjectURL(this.#objectUrl)
      } catch {
        /* ignore */
      }
      this.#objectUrl = null
    }
    this.#mediaSource = null
    this.#sourceBuffer = null
    this.#mseReady = new Promise<void>((resolve, reject) => {
      this.#mseReadyResolve = resolve
      this.#mseReadyReject = reject
    })
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
}
