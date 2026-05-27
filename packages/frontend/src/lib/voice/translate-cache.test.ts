/**
 * translate-cache.test.ts — round-trip + edge cases for the localStorage cache.
 *
 * happy-dom provides a working localStorage and SubtleCrypto, so these tests
 * don't need mocks beyond clearing storage between runs.
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
  clearTranslateCache,
  getCached,
  setCached,
  type TranslateResult,
} from "./translate-cache"

beforeEach(() => {
  clearTranslateCache()
})

describe("translate-cache", () => {
  it("round-trips a 'translated' entry", async () => {
    const value: TranslateResult = { status: "translated", text: "שלום" }
    await setCached("hello", "he", value)
    const got = await getCached("hello", "he")
    expect(got).toEqual(value)
  })

  it("round-trips an 'already_in_target' entry", async () => {
    const value: TranslateResult = { status: "already_in_target" }
    await setCached("כבר עברית", "he", value)
    const got = await getCached("כבר עברית", "he")
    expect(got).toEqual(value)
  })

  it("returns null for an unknown key", async () => {
    const got = await getCached("never-stored", "he")
    expect(got).toBeNull()
  })

  it("different targetLang produces different cache entries", async () => {
    await setCached("hello", "he", { status: "translated", text: "שלום" })
    await setCached("hello", "en", { status: "already_in_target" })
    expect(await getCached("hello", "he")).toEqual({ status: "translated", text: "שלום" })
    expect(await getCached("hello", "en")).toEqual({ status: "already_in_target" })
  })

  it("discards malformed JSON without throwing", async () => {
    // Manually plant a bad value to simulate corruption / older schema.
    const enc = new TextEncoder().encode("badkey|he")
    const buf = await crypto.subtle.digest("SHA-256", enc)
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    window.localStorage.setItem(`voice-acp:translate:v1:${hex}`, "not json {")
    const got = await getCached("badkey", "he")
    expect(got).toBeNull()
  })

  it("discards entries with an unknown status", async () => {
    // Plant a structurally valid but semantically invalid entry.
    const enc = new TextEncoder().encode("weird|he")
    const buf = await crypto.subtle.digest("SHA-256", enc)
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    window.localStorage.setItem(
      `voice-acp:translate:v1:${hex}`,
      JSON.stringify({ status: "mystery" }),
    )
    const got = await getCached("weird", "he")
    expect(got).toBeNull()
  })

  it("clearTranslateCache removes only v1-prefixed entries", async () => {
    await setCached("a", "he", { status: "translated", text: "א" })
    await setCached("b", "he", { status: "already_in_target" })
    window.localStorage.setItem("unrelated:key", "keep me")
    const removed = clearTranslateCache()
    expect(removed).toBe(2)
    expect(window.localStorage.getItem("unrelated:key")).toBe("keep me")
    expect(await getCached("a", "he")).toBeNull()
    expect(await getCached("b", "he")).toBeNull()
  })
})
