import { describe, expect, it, vi } from "vitest"
import { safeUUID } from "./uuid"

describe("safeUUID", () => {
  it("generates valid UUIDv4 format in normal environment", () => {
    const uuid = safeUUID()
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it("generates unique values on consecutive calls", () => {
    const u1 = safeUUID()
    const u2 = safeUUID()
    expect(u1).not.toBe(u2)
  })

  it("falls back gracefully when crypto.randomUUID is undefined (unsecure HTTP context)", () => {
    const origCrypto = globalThis.crypto
    vi.stubGlobal("crypto", { getRandomValues: (arr: Uint8Array) => arr.fill(15) })

    try {
      const uuid = safeUUID()
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    } finally {
      vi.stubGlobal("crypto", origCrypto)
    }
  })
})
