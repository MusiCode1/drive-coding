/**
 * pcm.test.ts — TDD לפונקציות PCM parsing.
 *
 * splitInt16LE: carry ריק + אורך זוגי → כל הדגימות, rest ריק
 *              carry של בייט אחד + chunk → little-endian נכון
 *              אורך אי-זוגי → דגימה אחרונה ב-rest
 *              chunk ריק → samples ריק
 * pcmToFloat32: ערכי-קצה (−32768/32767/0) + טווח כללי
 */

import { describe, expect, it } from "vitest"
import { pcmToFloat32, splitInt16LE } from "./pcm"

describe("splitInt16LE", () => {
  it("carry ריק + chunk זוגי → כל הדגימות, rest ריק", () => {
    // שתי דגימות: [0x01, 0x00] = 1, [0x02, 0x00] = 2
    const chunk = new Uint8Array([0x01, 0x00, 0x02, 0x00])
    const carry = new Uint8Array(0)
    const { samples, rest } = splitInt16LE(carry, chunk)
    expect(samples.length).toBe(2)
    expect(samples[0]).toBe(1)
    expect(samples[1]).toBe(2)
    expect(rest.length).toBe(0)
  })

  it("carry ריק + chunk אי-זוגי → דגימה אחת + rest של בייט אחד", () => {
    // שלושה בייטים: [0x01, 0x00, 0x03] → דגימה אחת (1) + rest [0x03]
    const chunk = new Uint8Array([0x01, 0x00, 0x03])
    const carry = new Uint8Array(0)
    const { samples, rest } = splitInt16LE(carry, chunk)
    expect(samples.length).toBe(1)
    expect(samples[0]).toBe(1)
    expect(rest.length).toBe(1)
    expect(rest[0]).toBe(0x03)
  })

  it("carry של בייט אחד + chunk → little-endian נכון", () => {
    // carry=[0x00], chunk=[0x01, 0x02, 0x00]
    // carry+chunk = [0x00, 0x01, 0x02, 0x00]
    // דגימות: [0x00,0x01] = byte0 + byte1<<8 = 0 + 256 = 256; [0x02,0x00] = 2
    const carry = new Uint8Array([0x00])
    const chunk = new Uint8Array([0x01, 0x02, 0x00])
    const { samples, rest } = splitInt16LE(carry, chunk)
    expect(samples.length).toBe(2)
    expect(samples[0]).toBe(256) // 0x0100 LE = 0x00 + 0x01<<8 = 256
    expect(samples[1]).toBe(2) // 0x0002 LE = 0x02 + 0x00<<8 = 2
    expect(rest.length).toBe(0)
  })

  it("chunk ריק → samples ריק, rest ריק", () => {
    const { samples, rest } = splitInt16LE(new Uint8Array(0), new Uint8Array(0))
    expect(samples.length).toBe(0)
    expect(rest.length).toBe(0)
  })

  it("carry ריק + chunk עם carry בסוף → rest נשמר נכון", () => {
    // chunk = [0xFF, 0x7F, 0xAA] → דגימה [0xFF,0x7F]=32767 + rest [0xAA]
    const { samples, rest } = splitInt16LE(new Uint8Array(0), new Uint8Array([0xff, 0x7f, 0xaa]))
    expect(samples.length).toBe(1)
    expect(samples[0]).toBe(32767) // Int16 max
    expect(rest.length).toBe(1)
    expect(rest[0]).toBe(0xaa)
  })
})

describe("pcmToFloat32", () => {
  it("0 → 0.0", () => {
    const samples = new Int16Array([0])
    const floats = pcmToFloat32(samples)
    expect(floats[0]).toBeCloseTo(0.0)
  })

  it("32767 (Int16 max) → ~1.0", () => {
    const samples = new Int16Array([32767])
    const floats = pcmToFloat32(samples)
    expect(floats[0]).toBeGreaterThan(0.99)
    expect(floats[0]).toBeLessThanOrEqual(1.0)
  })

  it("-32768 (Int16 min) → -1.0", () => {
    const samples = new Int16Array([-32768])
    const floats = pcmToFloat32(samples)
    expect(floats[0]).toBeCloseTo(-1.0)
  })

  it("מערך ריק → Float32Array ריק", () => {
    const floats = pcmToFloat32(new Int16Array(0))
    expect(floats.length).toBe(0)
  })

  it("ערכים כלליים בתחום [-1,1)", () => {
    const samples = new Int16Array([16384, -16384])
    const floats = pcmToFloat32(samples)
    expect(floats[0]).toBeGreaterThan(0.4)
    expect(floats[0]).toBeLessThan(0.6)
    expect(floats[1]).toBeGreaterThan(-0.6)
    expect(floats[1]).toBeLessThan(-0.4)
  })
})
