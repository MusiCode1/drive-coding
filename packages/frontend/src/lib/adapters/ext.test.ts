/**
 * ext.test.ts — integration tests ל-ExtClient facade (slice FE-normalization, Phase 1).
 *
 * Tests:
 *   1. setThinkingTokens validates params via parseExtParams and calls extMethod
 *   2. setThinkingTokens with n=null (no-limit) passes through correctly
 *   3. setThinkingTokens with invalid params throws (validation at boundary)
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
