/**
 * url-safe.test.ts — unit tests for safeUrlPathname (Commit 2 / TDD).
 *
 * safeUrlPathname must NEVER throw — even on malformed URL strings that make
 * `new URL()` throw TypeError. Returns null on bad input, pathname string on good input.
 *
 * Inputs validated empirically from §🔴 #3 in the bug review investigation.
 */

import { describe, expect, it } from "vitest"
import { safeUrlPathname } from "../src/delivery/url-safe.js"

describe("safeUrlPathname — pure URL helper, never throws", () => {
  // ── malformed inputs (must return null, never throw) ──────────────────────
  it("returns null for 'http://[' (malformed IPv6 bracket)", () => {
    expect(safeUrlPathname("http://[")).toBeNull()
  })

  it("returns null for '//[::1' (malformed authority with bracket)", () => {
    expect(safeUrlPathname("//[::1")).toBeNull()
  })

  it("returns null for 'http://%' (percent-encode error)", () => {
    expect(safeUrlPathname("http://%")).toBeNull()
  })

  // ── valid inputs (must return correct pathname) ───────────────────────────
  it("returns '/ws/echo' for '/ws/echo'", () => {
    expect(safeUrlPathname("/ws/echo")).toBe("/ws/echo")
  })

  it("returns '/ws/agent/x' for '/ws/agent/x'", () => {
    expect(safeUrlPathname("/ws/agent/x")).toBe("/ws/agent/x")
  })

  it("returns '/api/health' for '/api/health'", () => {
    expect(safeUrlPathname("/api/health")).toBe("/api/health")
  })

  // ── edge cases ────────────────────────────────────────────────────────────
  it("returns '/' for undefined", () => {
    expect(safeUrlPathname(undefined)).toBe("/")
  })

  it("returns '/' for empty string", () => {
    expect(safeUrlPathname("")).toBe("/")
  })

  it("returns '/ws/agent/abc-123' for a full http URL", () => {
    expect(safeUrlPathname("http://localhost:4000/ws/agent/abc-123")).toBe("/ws/agent/abc-123")
  })
})
