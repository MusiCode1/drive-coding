/**
 * pcm.ts — PCM parsing טהור (l16: signed 16-bit little-endian, 24kHz mono).
 *
 * אין IO — פונקציות טהורות בלבד. מתאים ל-core (אין browser globals).
 *
 * שימוש: Gemini TTS מחזיר זרם PCM (base64-decoded) שמגיע בחתיכות.
 * splitInt16LE מטפל בחתיכות בגבול אי-זוגי (byte boundary) באמצעות carry.
 * pcmToFloat32 ממיר ל-Float32 [-1,1) לשימוש ב-WebAudio AudioBuffer.
 */

/**
 * מצרף carry (בייט-עודף קודם) ל-chunk, מפענח ל-Int16Array,
 * מחזיר rest (בייט-עודף חדש אם האורך הכולל אי-זוגי).
 *
 * l16 = little-endian: byte0 = LSB, byte1 = MSB.
 * בלי spread — בטוח לחתיכות גדולות (ר' base64.ts comment).
 */
export function splitInt16LE(
  carry: Uint8Array,
  chunk: Uint8Array,
): { samples: Int16Array; rest: Uint8Array } {
  // צרף carry + chunk לבאפר אחד
  const combined = new Uint8Array(carry.length + chunk.length)
  combined.set(carry, 0)
  combined.set(chunk, carry.length)

  const totalBytes = combined.length
  const sampleCount = Math.floor(totalBytes / 2)
  const usedBytes = sampleCount * 2

  // פענח Int16 LE: byte0 + byte1 << 8 (signed)
  const samples = new Int16Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    // noUncheckedIndexedAccess: הגבלנו את הלולאה ל-sampleCount pairs, כך שהאינדקסים תמיד קיימים
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lo = combined[i * 2] ?? 0
    const hi = combined[i * 2 + 1] ?? 0
    // LoB + HiB<<8, הפוך ל-signed 16-bit
    const unsigned = lo | (hi << 8)
    // המרה ל-signed: אם ביט 15 דלוק → שלילי
    samples[i] = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned
  }

  // rest = בייט עודף (אם יש)
  const rest = usedBytes < totalBytes ? combined.slice(usedBytes) : new Uint8Array(0)

  return { samples, rest }
}

/**
 * Int16 [-32768, 32767] → Float32 [-1, 1).
 *
 * חלוקה ב-32768 מבטיחה ש-−32768 → −1.0 ו-32767 → ~0.99997.
 */
export function pcmToFloat32(samples: Int16Array): Float32Array {
  const floats = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    floats[i] = (samples[i] ?? 0) / 32768
  }
  return floats
}
