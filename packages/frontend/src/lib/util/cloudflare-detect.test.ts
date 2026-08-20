/**
 * cloudflare-detect.test.ts — זיהוי Cloudflare (slice liveness C4).
 */
import { describe, expect, it } from "vitest"
import { isCloudflareChallenge } from "./cloudflare-detect"

describe("isCloudflareChallenge", () => {
  it("cf-ray header → true", () => {
    const res = {
      headers: { get: (k: string) => (k === "cf-ray" ? "abc" : null) },
    } as Response
    expect(isCloudflareChallenge(res, "")).toBe(true)
  })

  it("Just a moment body → true", () => {
    expect(isCloudflareChallenge(null, "<html>Just a moment...</html>")).toBe(true)
  })

  it("generic error → false", () => {
    expect(isCloudflareChallenge(null, "ECONNREFUSED")).toBe(false)
  })
})
