/**
 * ext.test.ts — integration tests ל-ExtClient facade (slice FE-normalization, Phase 1;
 * slice session-budget-meter Commit 4 — getQuota).
 *
 * Tests:
 *   1. setThinkingTokens validates params via parseExtParams and calls extMethod
 *   2. setThinkingTokens with n=null (no-limit) passes through correctly
 *   3. setThinkingTokens with invalid params throws (validation at boundary)
 *   4. getQuota validates params, calls extMethod, validates+returns result.snapshot
 *   5. getQuota with an invalid raw result throws (result validation at boundary)
 */
import type { AcpClient } from "@drive-coding/provider/client"
import { describe, expect, it, vi } from "vitest"
import { createExtClient } from "./ext"

function makeClient(extMethodSpy = vi.fn().mockResolvedValue({ ok: true })): AcpClient {
  return {
    extMethod: extMethodSpy,
    conn: {} as AcpClient["conn"],
    capabilities: {} as AcpClient["capabilities"],
    newSession: vi.fn(),
    loadSession: vi.fn(),
    listSessions: vi.fn(),
    prompt: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
    setSessionConfigOption: vi.fn(),
    setSessionMode: vi.fn(),
    setSessionModel: vi.fn(),
  } as unknown as AcpClient
}

describe("ExtClient.setThinkingTokens", () => {
  it("validates params and calls extMethod with correct args", async () => {
    const extMethodSpy = vi.fn().mockResolvedValue({ ok: true })
    const client = makeClient(extMethodSpy)
    const ext = createExtClient(client)

    await ext.setThinkingTokens("session-abc", 1024)

    expect(extMethodSpy).toHaveBeenCalledOnce()
    expect(extMethodSpy).toHaveBeenCalledWith("_drive/setThinkingTokens", {
      sessionId: "session-abc",
      n: 1024,
    })
  })

  it("passes n=null (no-limit) through correctly", async () => {
    const extMethodSpy = vi.fn().mockResolvedValue({ ok: true })
    const client = makeClient(extMethodSpy)
    const ext = createExtClient(client)

    await ext.setThinkingTokens("session-xyz", null)

    expect(extMethodSpy).toHaveBeenCalledWith("_drive/setThinkingTokens", {
      sessionId: "session-xyz",
      n: null,
    })
  })

  it("throws on invalid params (ArkType validation)", async () => {
    const extMethodSpy = vi.fn()
    const client = makeClient(extMethodSpy)
    const ext = createExtClient(client)

    // n must be number | null, not string
    await expect(
      ext.setThinkingTokens("session-abc", "not-a-number" as unknown as number),
    ).rejects.toThrow("Invalid params")

    // extMethod should NOT be called when params are invalid
    expect(extMethodSpy).not.toHaveBeenCalled()
  })
})

describe("ExtClient.getQuota", () => {
  it("validates params, calls extMethod, and returns the validated snapshot", async () => {
    const raw = {
      snapshot: {
        provider: "claude",
        plan: "max",
        windows: [
          {
            id: "five_hour",
            period: { kind: "rolling", durationSeconds: 18_000 },
            consumption: { kind: "percentage", usedPct: 42 },
            resetsAtMs: 1_700_000_000_000,
          },
        ],
      },
    }
    const extMethodSpy = vi.fn().mockResolvedValue(raw)
    const client = makeClient(extMethodSpy)
    const ext = createExtClient(client)

    const result = await ext.getQuota("session-abc")

    expect(extMethodSpy).toHaveBeenCalledOnce()
    expect(extMethodSpy).toHaveBeenCalledWith("_drive/getQuota", { sessionId: "session-abc" })
    expect(result).toEqual(raw.snapshot)
  })

  it("returns null when the raw result is { snapshot: null } (valid — no limits available)", async () => {
    const extMethodSpy = vi.fn().mockResolvedValue({ snapshot: null })
    const client = makeClient(extMethodSpy)
    const ext = createExtClient(client)

    const result = await ext.getQuota("session-xyz")

    expect(result).toBeNull()
  })

  it("throws on invalid params — sessionId must be a string", async () => {
    const extMethodSpy = vi.fn()
    const client = makeClient(extMethodSpy)
    const ext = createExtClient(client)

    await expect(ext.getQuota(123 as unknown as string)).rejects.toThrow("Invalid params")
    expect(extMethodSpy).not.toHaveBeenCalled()
  })

  it("throws on invalid raw result — bare top-level null is rejected (not { snapshot: null })", async () => {
    const extMethodSpy = vi.fn().mockResolvedValue(null)
    const client = makeClient(extMethodSpy)
    const ext = createExtClient(client)

    await expect(ext.getQuota("session-abc")).rejects.toThrow("Invalid result")
  })

  it("throws on invalid raw result — malformed window (usedPct out of range)", async () => {
    const extMethodSpy = vi.fn().mockResolvedValue({
      snapshot: {
        provider: "claude",
        windows: [
          {
            id: "x",
            period: { kind: "rolling", durationSeconds: 10 },
            consumption: { kind: "percentage", usedPct: 999 },
            resetsAtMs: null,
          },
        ],
      },
    })
    const client = makeClient(extMethodSpy)
    const ext = createExtClient(client)

    await expect(ext.getQuota("session-abc")).rejects.toThrow("Invalid result")
  })
})
