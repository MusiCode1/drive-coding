/**
 * public-base-url.test.ts — normalizePublicBaseUrl contract.
 */

import { describe, expect, it } from "vitest"
import { normalizePublicBaseUrl } from "./public-base-url.js"

describe("normalizePublicBaseUrl", () => {
  it("1. empty / whitespace-only → undefined", () => {
    expect(normalizePublicBaseUrl("")).toBeUndefined()
    expect(normalizePublicBaseUrl("   ")).toBeUndefined()
  })

  it("2. invalid URL → undefined", () => {
    expect(normalizePublicBaseUrl("not-a-url")).toBeUndefined()
    expect(normalizePublicBaseUrl("://missing-scheme")).toBeUndefined()
  })

  it("3. non-http(s) scheme → undefined", () => {
    expect(normalizePublicBaseUrl("ftp://example.com")).toBeUndefined()
    expect(normalizePublicBaseUrl("file:///etc/passwd")).toBeUndefined()
  })

  it("4. path / search / hash → undefined", () => {
    expect(normalizePublicBaseUrl("https://example.com/api")).toBeUndefined()
    expect(normalizePublicBaseUrl("https://example.com?x=1")).toBeUndefined()
    expect(normalizePublicBaseUrl("https://example.com#frag")).toBeUndefined()
  })

  it("5. bare origin → normalized origin", () => {
    expect(normalizePublicBaseUrl("https://example.com")).toBe("https://example.com")
    expect(normalizePublicBaseUrl("http://localhost:4360")).toBe("http://localhost:4360")
  })

  it("6. trailing slash on origin-only input → origin without slash", () => {
    expect(normalizePublicBaseUrl("https://example.com/")).toBe("https://example.com")
  })

  it("7. idempotent: f(f(x)) === f(x)", () => {
    const inputs = [
      "https://example.com",
      "http://localhost:4360",
      "https://example.com/",
    ]
    for (const raw of inputs) {
      const once = normalizePublicBaseUrl(raw)
      if (once === undefined) continue
      expect(normalizePublicBaseUrl(once)).toBe(once)
    }
  })
})
