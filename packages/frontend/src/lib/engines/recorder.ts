/**
 * Recorder — עוטף את ה-MediaRecorder עבור פונקציונליות push-to-talk.
 * מחזיר API נקי של `{ start(), stop(): Promise<{ blob, mimeType }> }`.
 *
 * הועתק מתוך main/packages/frontend/src/lib/audio/recorder.ts (slice 3).
 * שינויים: הוחלף `import { createLogger } from "$lib/log"` + קריאות ללוג
 * ב-console.warn/info (ל-FE החדש אין מודול $lib/log).
 */

export class Recorder {
  private mr: MediaRecorder | null = null
  private chunks: Blob[] = []

  async start(): Promise<void> {
    console.info("[recorder] start")
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e: unknown) {
      console.warn("[recorder] mic permission denied", String(e))
      throw e
    }
    // הסוג audio/webm;codecs=opus נתמך ב-Chrome/Firefox; יש גיבוי ל-default של הדפדפן
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm"
    this.mr = new MediaRecorder(stream, { mimeType })
    this.chunks = []
    this.mr.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.mr.start()
  }

  stop(): Promise<{ blob: Blob; mimeType: string }> {
    return new Promise((resolve) => {
      if (!this.mr) {
        resolve({ blob: new Blob(), mimeType: "audio/webm" })
        return
      }
      const mimeType = this.mr.mimeType || "audio/webm"
      this.mr.onstop = () => {
        const blob = new Blob(this.chunks, { type: mimeType })
        console.info("[recorder] stop", { bytes: blob.size, mimeType })
        this.mr?.stream.getTracks().forEach((t) => {
          t.stop()
        })
        this.mr = null
        resolve({ blob, mimeType })
      }
      this.mr.stop()
    })
  }

  get isRecording(): boolean {
    return this.mr !== null && this.mr.state === "recording"
  }
}
