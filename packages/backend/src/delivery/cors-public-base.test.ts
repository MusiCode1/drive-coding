import { describe, expect, it } from "vitest"
import { effectiveCorsOrigins } from "./cors-config.js"

describe("effectiveCorsOrigins", () => {
  it("1. missing/invalid publicBaseUrl → same as parseCorsOrigins (including single string)", () => {
    expect(effectiveCorsOrigins(undefined, undefined)).toEqual(["http://localhost:5173"])
    expect(effectiveCorsOrigins("", undefined)).toEqual(["http://localhost:5173"])
    expect(effectiveCorsOrigins("https://a.example.com", undefined)).toBe("https://a.example.com")
    expect(effectiveCorsOrigins(undefined, "not-an-origin")).toEqual(["http://localhost:5173"])
  })

  it('2. parseCorsOrigins returned "*" → returns "*"', () => {
    expect(effectiveCorsOrigins("*", "https://public.example.com")).toBe("*")
  })

  it("3. unions public origin without duplicates, existing first", () => {
    expect(
      effectiveCorsOrigins("http://localhost:5173,https://a.example.com", "https://b.example.com"),
    ).toEqual(["http://localhost:5173", "https://a.example.com", "https://b.example.com"])
    expect(
      effectiveCorsOrigins("https://a.example.com", "https://a.example.com"),
    ).toEqual(["https://a.example.com"])
  })

  it("4. undefined rawCorsOrigins + publicBaseUrl → default localhost + public", () => {
    expect(effectiveCorsOrigins(undefined, "https://public.example.com")).toEqual([
      "http://localhost:5173",
      "https://public.example.com",
    ])
  })
})
