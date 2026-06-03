/**
 * פונקציות עיבוד אודיו טהורות לצורך pipeline של wake-word.
 * אין תלות ב-ort / DOM — ניתן לטסט ב-Node.
 *
 * מקור: poc/wake-word-orb/wake-word-lib.js
 */

export const SAMPLE_RATE = 16000
export const FRAME_SIZE = 1280 // 80ms @ 16kHz
export const VAD_THRESHOLD = 0.5
export const DETECT_THRESHOLD = 0.5

/**
 * RMS (loudness) של frame, 0..~1.
 * מקביל ל-computeRms ב-POC.
 */
export function computeRms(chunk: Float32Array): number {
  let sum = 0
  for (let i = 0; i < chunk.length; i++) {
    const s = chunk[i] ?? 0
    sum += s * s
  }
  return Math.sqrt(sum / chunk.length)
}

/**
 * ממיר נתוני mel in-place: x → x/10 + 2.
 * הנוסחה הזו הייתה inline ב-runMelspec ב-POC (wake-word-lib.js:163).
 * כאן מחולצת לפונקציה טהורה testable.
 * (AHA #1)
 */
export function transformMel(data: Float32Array): void {
  for (let j = 0; j < data.length; j++) {
    const v = data[j] ?? 0
    data[j] = v / 10.0 + 2.0
  }
}
