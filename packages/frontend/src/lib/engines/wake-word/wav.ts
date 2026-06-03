/**
 * encodeWav — ממיר Float32Array frames ל-WAV Uint8Array (PCM16 mono).
 *
 * מקביל ל-createWavBlob ב-POC (poc/wake-word-orb/wake-word-lib.js:259),
 * אך מחזיר Uint8Array (טהור/testable) במקום Blob.
 * ה-VM/route עוטפים ל-Blob לפי הצורך.
 *
 * מחזיר null אם הסכום הכולל של frames ריק.
 */

export { SAMPLE_RATE } from "./audio-math.js"
import { SAMPLE_RATE } from "./audio-math.js"

export function encodeWav(
  frames: Float32Array[],
  sampleRate: number = SAMPLE_RATE,
): Uint8Array | null {
  const total = frames.reduce((n, f) => n + f.length, 0)
  if (total === 0) return null

  // חיבור כל ה-frames לבאפר אחד
  const combined = new Float32Array(total)
  let off = 0
  for (const f of frames) {
    combined.set(f, off)
    off += f.length
  }

  // המרה ל-PCM16 (signed int16)
  const pcm = new Int16Array(total)
  for (let i = 0; i < total; i++) {
    const raw = combined[i] ?? 0
    const s = Math.max(-1, Math.min(1, raw))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }

  // בניית WAV header (44 bytes)
  const ch = 1
  const bits = 16
  const header = new ArrayBuffer(44)
  const v = new DataView(header)

  v.setUint32(0, 0x52494646, false) // "RIFF"
  v.setUint32(4, 36 + pcm.byteLength, true) // file size - 8
  v.setUint32(8, 0x57415645, false) // "WAVE"
  v.setUint32(12, 0x666d7420, false) // "fmt "
  v.setUint32(16, 16, true) // fmt chunk size
  v.setUint16(20, 1, true) // PCM format
  v.setUint16(22, ch, true) // channels
  v.setUint32(24, sampleRate, true) // sample rate
  v.setUint32(28, sampleRate * ch * (bits / 8), true) // byte rate
  v.setUint16(32, ch * (bits / 8), true) // block align
  v.setUint16(34, bits, true) // bits per sample
  v.setUint32(36, 0x64617461, false) // "data"
  v.setUint32(40, pcm.byteLength, true) // data size

  // שרשור header + PCM
  const result = new Uint8Array(44 + pcm.byteLength)
  result.set(new Uint8Array(header), 0)
  result.set(new Uint8Array(pcm.buffer), 44)
  return result
}
