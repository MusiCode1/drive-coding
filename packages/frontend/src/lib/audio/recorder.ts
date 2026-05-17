/**
 * Recorder — wraps MediaRecorder for push-to-talk.
 * Returns a clean `{ start(), stop(): Promise<{ blob, mimeType }> }` API.
 */
import { createLogger } from "$lib/log"

const log = createLogger("fe.audio.recorder")

export class Recorder {
  private mr: MediaRecorder | null = null
  private chunks: Blob[] = []

  async start(): Promise<void> {
    log.info({}, "start")
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e: unknown) {
      log.error({ err: String(e) }, "mic permission denied")
      throw e
    }
    // audio/webm;codecs=opus is supported in Chrome/Firefox; falls back to browser default
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
        log.info({ bytes: blob.size, mimeType }, "stop")
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
