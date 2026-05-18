/**
 * base64.test.ts — MED-5: chunked base64 conversion works on large audio
 */

import { describe, expect, it } from "vitest"
import { bytesToBase64 } from "./base64"

describe("bytesToBase64", () => {
  it("converts small buffer correctly", () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
    expect(bytesToBase64(bytes)).toBe(btoa("Hello"))
  })

  it("converts empty buffer", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("")
  })

  it("handles buffer larger than 8192 bytes (stack-safe)", () => {
    // Regular btoa(String.fromCharCode(...)) would throw on 200KB audio
    const large = new Uint8Array(200_000)
    // Fill with non-zero values
    for (let i = 0; i < large.length; i++) {
      large[i] = (i * 7 + 3) % 256
    }

    // Should not throw
    let result = ""
    expect(() => {
      result = bytesToBase64(large)
    }).not.toThrow()

    // Verify round-trip: atob(result) should match original bytes
    const decoded = atob(result)
    expect(decoded.length).toBe(large.length)
    // Spot-check first/last bytes
    expect(decoded.charCodeAt(0)).toBe(large[0])
    expect(decoded.charCodeAt(large.length - 1)).toBe(large[large.length - 1])
  })

  it("handles exactly 8192 bytes (chunk boundary)", () => {
    const exact = new Uint8Array(8192).fill(0xab)
    const result = bytesToBase64(exact)
    expect(result.length).toBeGreaterThan(0)
    // Round-trip check
    const decoded = atob(result)
    expect(decoded.length).toBe(8192)
    expect(decoded.charCodeAt(0)).toBe(0xab)
  })

  it("handles 8193 bytes (one over chunk boundary)", () => {
    const bytes = new Uint8Array(8193).fill(0x42)
    const result = bytesToBase64(bytes)
    const decoded = atob(result)
    expect(decoded.length).toBe(8193)
  })
})
