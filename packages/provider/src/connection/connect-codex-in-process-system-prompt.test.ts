/**
 * connect-codex-in-process-system-prompt.test.ts — integration test for the codex
 * systemPrompt → config.developer_instructions mapping (slice project-system-prompt Commit 1).
 *
 * connectCodexInProcess calls startAcpServer(serverIn, serverOut, { codexPath, config }).
 * We mock @musicode1/codex-acp/lib to capture the `config` argument without needing a
 * live codex binary — verifies the mapping wired in connect-codex-in-process.ts:
 *   opts.systemPrompt ? { developer_instructions: opts.systemPrompt } : undefined
 *
 * Live verification (DoD #7 — codex actually honors developer_instructions) is covered
 * separately by calev verifier-phase / manual smoke, per brief §4 Commit 1 Verification.
 */

import { describe, expect, it, vi } from "vitest"

const startAcpServerMock = vi.fn()

vi.mock("@musicode1/codex-acp/lib", () => ({
  startAcpServer: (...args: unknown[]) => startAcpServerMock(...args),
}))

describe("connectCodexInProcess — systemPrompt → config.developer_instructions", () => {
  it("systemPrompt set → startAcpServer called with config.developer_instructions", async () => {
    startAcpServerMock.mockClear()
    const { connectCodexInProcess } = await import("./connect-codex-in-process.js")
    const conn = await connectCodexInProcess({
      cwd: "/tmp",
      systemPrompt: "Always end every reply with ZQX_CDX",
    })
    try {
      expect(startAcpServerMock).toHaveBeenCalledTimes(1)
      const opts = startAcpServerMock.mock.calls[0]?.[2] as { config?: unknown }
      expect(opts.config).toEqual({ developer_instructions: "Always end every reply with ZQX_CDX" })
    } finally {
      await conn.close()
    }
  })

  it("systemPrompt null → startAcpServer called with config: undefined", async () => {
    startAcpServerMock.mockClear()
    const { connectCodexInProcess } = await import("./connect-codex-in-process.js")
    const conn = await connectCodexInProcess({ cwd: "/tmp", systemPrompt: null })
    try {
      expect(startAcpServerMock).toHaveBeenCalledTimes(1)
      const opts = startAcpServerMock.mock.calls[0]?.[2] as { config?: unknown }
      expect(opts.config).toBeUndefined()
    } finally {
      await conn.close()
    }
  })

  it("systemPrompt undefined (omitted) → startAcpServer called with config: undefined", async () => {
    startAcpServerMock.mockClear()
    const { connectCodexInProcess } = await import("./connect-codex-in-process.js")
    const conn = await connectCodexInProcess({ cwd: "/tmp" })
    try {
      expect(startAcpServerMock).toHaveBeenCalledTimes(1)
      const opts = startAcpServerMock.mock.calls[0]?.[2] as { config?: unknown }
      expect(opts.config).toBeUndefined()
    } finally {
      await conn.close()
    }
  })

  it("systemPrompt empty string → startAcpServer called with config: undefined (falsy)", async () => {
    startAcpServerMock.mockClear()
    const { connectCodexInProcess } = await import("./connect-codex-in-process.js")
    const conn = await connectCodexInProcess({ cwd: "/tmp", systemPrompt: "" })
    try {
      expect(startAcpServerMock).toHaveBeenCalledTimes(1)
      const opts = startAcpServerMock.mock.calls[0]?.[2] as { config?: unknown }
      expect(opts.config).toBeUndefined()
    } finally {
      await conn.close()
    }
  })
})
