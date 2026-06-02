/**
 * Tests for wav.ts — encodeWav.
 * Pure function, no DOM, no ort dependency.
 */

import { describe, expect, test } from "vitest"
import { encodeWav, SAMPLE_RATE } from "./wav.js"

describe("encodeWav", () => {
  test("empty frames → null", () => {
    expect(encodeWav([])).toBeNull()
  })

  test("single frame of zeros → valid WAV bytes", () => {
    const frame = new Float32Array(8).fill(0)
    const result = encodeWav([frame])
    expect(result).not.toBeNull()
    // 44 byte header + 8 samples * 2 bytes PCM16
    expect(result!.byteLength).toBe(44 + 8 * 2)
  })

  test("RIFF header: starts with 'RIFF'", () => {
    const frame = new Float32Array(4).fill(0)
    const bytes = encodeWav([frame])!
    // RIFF (0x52494646)
    expect(bytes[0]).toBe(0x52)
    expect(bytes[1]).toBe(0x49)
    expect(bytes[2]).toBe(0x46)
    expect(bytes[3]).toBe(0x46)
  })

  test("WAVE marker at offset 8", () => {
    const frame = new Float32Array(4).fill(0)
    const bytes = encodeWav([frame])!
    // WAVE (0x57415645)
    expect(bytes[8]).toBe(0x57)
    expect(bytes[9]).toBe(0x41)
    expect(bytes[10]).toBe(0x56)
    expect(bytes[11]).toBe(0x45)
  })

  test("data chunk marker at offset 36", () => {
    const frame = new Float32Array(4).fill(0)
    const bytes = encodeWav([frame])!
    // data (0x64617461)
    expect(bytes[36]).toBe(0x64)
    expect(bytes[37]).toBe(0x61)
    expect(bytes[38]).toBe(0x74)
    expect(bytes[39]).toBe(0x61)
  })

  test("PCM16 size = total samples × 2", () => {
    const f1 = new Float32Array(100).fill(0.5)
    const f2 = new Float32Array(50).fill(-0.5)
    const bytes = encodeWav([f1, f2])!
    expect(bytes.byteLength).toBe(44 + (100 + 50) * 2)
  })

  test("positive full-scale → 0x7FFF", () => {
    const frame = new Float32Array([1.0])
    const bytes = encodeWav([frame])!
    // PCM16 starts at offset 44, little-endian — use DataView for strict safety
    const dv = new DataView(bytes.buffer, bytes.byteOffset)
    const value = dv.getInt16(44, true) // little-endian
    expect(value).toBe(0x7fff)
  })

  test("negative full-scale → -32768 (0x8000 unsigned)", () => {
    const frame = new Float32Array([-1.0])
    const bytes = encodeWav([frame])!
    const dv = new DataView(bytes.buffer, bytes.byteOffset)
    const value = dv.getInt16(44, true)
    expect(value).toBe(-0x8000)
  })

  test("respects sampleRate param in header", () => {
    const frame = new Float32Array(4).fill(0)
    const bytes = encodeWav([frame], 8000)!
    const dv = new DataView(bytes.buffer, bytes.byteOffset)
    const sr = dv.getUint32(24, true)
    expect(sr).toBe(8000)
  })

  test("default sampleRate is SAMPLE_RATE (16000)", () => {
    const frame = new Float32Array(4).fill(0)
    const bytes = encodeWav([frame])!
    const dv = new DataView(bytes.buffer, bytes.byteOffset)
    const sr = dv.getUint32(24, true)
    expect(sr).toBe(SAMPLE_RATE)
  })
})
