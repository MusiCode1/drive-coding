/**
 * sessions-cache.test.ts — unit tests for localStorage session cache.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearCachedSessions,
  loadCachedSessions,
  saveCachedSessions,
} from "./sessions-cache"
import type { SessionInfo } from "$lib/api/sessions-ws"

const CWD = "/home/user/my-project"

const SAMPLE: SessionInfo[] = [
  { sessionId: "s1", cwd: CWD, title: "session one", updatedAt: "2025-01-01T00:00:00Z" },
  { sessionId: "s2", cwd: CWD, title: "session two", updatedAt: "2025-02-01T00:00:00Z" },
]

describe("sessions-cache", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it("save → load returns the same sessions", () => {
    saveCachedSessions(CWD, SAMPLE)
    const result = loadCachedSessions(CWD)
    expect(result).toEqual(SAMPLE)
  })

  it("load returns null when nothing is saved", () => {
    expect(loadCachedSessions(CWD)).toBeNull()
  })

  it("load returns null after TTL expires (15 min)", () => {
    vi.useFakeTimers()
    saveCachedSessions(CWD, SAMPLE)
    // Advance past TTL
    vi.advanceTimersByTime(15 * 60 * 1_000 + 1)
    expect(loadCachedSessions(CWD)).toBeNull()
  })

  it("expired entry is removed from localStorage", () => {
    vi.useFakeTimers()
    saveCachedSessions(CWD, SAMPLE)
    vi.advanceTimersByTime(15 * 60 * 1_000 + 1)
    loadCachedSessions(CWD) // triggers removal
    // After expiry + load, saving again should work fine
    saveCachedSessions(CWD, [SAMPLE[0]!])
    expect(loadCachedSessions(CWD)).toHaveLength(1)
  })

  it("clearCachedSessions removes the entry", () => {
    saveCachedSessions(CWD, SAMPLE)
    clearCachedSessions(CWD)
    expect(loadCachedSessions(CWD)).toBeNull()
  })

  it("different cwds are stored independently", () => {
    const cwd2 = "/home/user/other-project"
    saveCachedSessions(CWD, SAMPLE)
    saveCachedSessions(cwd2, [SAMPLE[1]!])
    expect(loadCachedSessions(CWD)).toHaveLength(2)
    expect(loadCachedSessions(cwd2)).toHaveLength(1)
    clearCachedSessions(CWD)
    expect(loadCachedSessions(CWD)).toBeNull()
    expect(loadCachedSessions(cwd2)).toHaveLength(1)
  })

  it("load returns null on corrupt JSON", () => {
    localStorage.setItem("voice-acp:sessions:" + CWD, "not-json{{{")
    expect(loadCachedSessions(CWD)).toBeNull()
  })
})
