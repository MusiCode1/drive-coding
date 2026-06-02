/**
 * WakeWordCapture — מאגר wake-to-wake recording.
 *
 * מקביל ל-createCapture ב-POC (poc/wake-word-orb/capture.js).
 * detect #1 → start → אגירת frames → detect #2 → WAV.
 * שקט לא עוצר (המשתמש עשוי לחשוב). detect שני גורם לסיום.
 *
 * שינויים מה-POC:
 *   - מחזיר Uint8Array (encodeWav) ולא Blob — ה-VM עוטף ל-Blob.
 *   - trimFrames הוא פרמטר של stop(), לא DOM input.
 *   - אין תלות ב-DOM.
 */

import { encodeWav, SAMPLE_RATE } from "./wav.js"
import { FRAME_SIZE } from "./audio-math.js"

export interface CaptureResult {
  wavBytes: Uint8Array
  frames: number
}

export class WakeWordCapture {
  private captureActive = false
  private buffer: Float32Array[] = []

  /** מוסיף frame לבאפר (כשבמצב recording). */
  pushFrame(frame: Float32Array): void {
    if (this.captureActive) {
      // מעתיק — AudioWorklet עשוי לשתף buffer
      this.buffer.push(new Float32Array(frame))
    }
  }

  /** מתחיל הקלטה. */
  start(): void {
    this.captureActive = true
    this.buffer = []
  }

  /**
   * עוצר הקלטה ומחזיר WAV bytes.
   * @param trimFrames - כמה frames לחתוך מהסוף (להסיר wake-word שני). ברירת מחדל 16.
   */
  stop(trimFrames = 16): CaptureResult | null {
    this.captureActive = false
    const kept =
      trimFrames > 0
        ? this.buffer.slice(0, Math.max(0, this.buffer.length - trimFrames))
        : this.buffer.slice()
    const totalSamples = kept.reduce((n, f) => n + f.length, 0)
    const wavBytes = encodeWav(kept, SAMPLE_RATE)
    this.buffer = []
    if (!wavBytes) return null
    return { wavBytes, frames: Math.round(totalSamples / FRAME_SIZE) }
  }

  /** עוצר בכוח בלי לשמור (למשל: המשתמש לחץ Stop במהלך הקלטה). */
  abort(): void {
    this.captureActive = false
    this.buffer = []
  }

  get capturing(): boolean {
    return this.captureActive
  }
}
