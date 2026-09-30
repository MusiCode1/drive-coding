/**
 * attach-status-gate DoD 7b — leaveRunning must not leak unhandled rejection when sendRaw throws.
 */

import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockClient: AcpClient = {
  conn: {} as AcpClient["conn"],
  capabilities: {} as AcpClient["capabilities"],
  newSession: vi.fn().mockResolvedValue({ sessionId: "session-detach-sendraw" }),
  loadSession: vi.fn().mockResolvedValue({}),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  prompt: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  setSessionConfigOption: vi.fn(),
  setSessionMode: vi.fn(),
  setSessionModel: vi.fn(),
  extMethod: vi.fn().mockResolvedValue({ ok: true }),
} as unknown as AcpClient

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(() => Promise.resolve(mockClient)),
  }
})

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
      sendRaw: vi.fn(),
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-detach-sendraw" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

vi.mock("$lib/adapters/ext", () => ({
  createExtClient: vi.fn(() => ({})),
}))

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" })

import { AgentSession } from "./agent-session.svelte"

describe("gate 7b — leaveRunning when sendRaw throws", () => {
  let session: AgentSession

  beforeEach(async () => {
    ;(mockClient.close as ReturnType<typeof vi.fn>).mockClear()
    session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "claude" })
    session._setStatusForTest("connected")
    const sendRaw = vi.fn(() => {
      throw new Error("transport closed")
    })
    session._setTransportForTest({
      closeAndWait: vi.fn().mockResolvedValue(undefined),
      sendRaw,
    })
  })

  it("leaveRunning() resolves and status becomes idle", async () => {
    await expect(session.leaveRunning()).resolves.toBeUndefined()
    expect(session.status).toBe("idle")
  })

  it("#client.close() still runs after sendRaw throw", async () => {
    await session.leaveRunning()
    expect(mockClient.close).toHaveBeenCalled()
  })
})
