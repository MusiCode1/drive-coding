/**
 * connect-codex-in-process — instructions priority and TDZ gate (startCodexAcp wiring).
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const startCodexAcpMock = vi.fn()

vi.mock("./codex-acp-startup.js", () => ({
  startCodexAcp: (...args: unknown[]) => startCodexAcpMock(...args),
  projectTrustConfigArg: vi.fn(),
  composeDeveloperInstructions: vi.fn(),
  readEffectiveDeveloperInstructions: vi.fn(),
}))

describe("connectCodexInProcess — startCodexAcp instructions", () => {
  beforeEach(() => {
    startCodexAcpMock.mockClear()
    startCodexAcpMock.mockImplementation(() => {})
  })

  it("agentPrompt wins over systemPrompt", async () => {
    const { connectCodexInProcess } = await import("./connect-codex-in-process.js")
    const conn = await connectCodexInProcess({
      cwd: "/tmp",
      agentPrompt: "FULL_SURFACE",
      systemPrompt: "CHARTER_ONLY",
    })
    try {
      expect(startCodexAcpMock).toHaveBeenCalledTimes(1)
      const deps = startCodexAcpMock.mock.calls[0]?.[0] as { instructions?: string }
      expect(deps.instructions).toBe("FULL_SURFACE")
    } finally {
      await conn.close()
    }
  })

  it("falls back to systemPrompt when agentPrompt absent", async () => {
    const { connectCodexInProcess } = await import("./connect-codex-in-process.js")
    const conn = await connectCodexInProcess({
      cwd: "/tmp",
      systemPrompt: "CHARTER_ONLY",
    })
    try {
      const deps = startCodexAcpMock.mock.calls[0]?.[0] as { instructions?: string }
      expect(deps.instructions).toBe("CHARTER_ONLY")
    } finally {
      await conn.close()
    }
  })

  it("connect without instructions still invokes startCodexAcp (TDZ gate)", async () => {
    startCodexAcpMock.mockImplementation(({ isClosed, onStartupError }) => {
      expect(isClosed()).toBe(false)
      expect(onStartupError).toEqual(expect.any(Function))
    })
    const { connectCodexInProcess } = await import("./connect-codex-in-process.js")
    const conn = await connectCodexInProcess({ cwd: "/tmp" })
    try {
      expect(startCodexAcpMock).toHaveBeenCalledTimes(1)
      const deps = startCodexAcpMock.mock.calls[0]?.[0] as { instructions?: string }
      expect(deps.instructions).toBeUndefined()
    } finally {
      await conn.close()
    }
  })
})
