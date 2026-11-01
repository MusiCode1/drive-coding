/**
 * Budget lifecycle boundaries — capture/cleanup/identity (slice state-agent-session-budget-owner).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-budget-life", status: "running" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
  getAgent: vi.fn().mockRejectedValue(new Error("not relevant")),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

const mockColdClient = vi.hoisted(() => ({
  newSession: vi.fn().mockResolvedValue({ sessionId: "sess-m06" }),
  loadSession: vi.fn(),
  close: vi.fn(),
  extMethod: vi.fn().mockResolvedValue({ ok: true }),
}))

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

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn().mockResolvedValue(mockColdClient),
    createAttachedAcpClient: vi.fn(),
  }
})

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("test-uuid") })

import { deleteAgent } from "$lib/adapters/agents-api"
import { AgentSession } from "./agent-session.svelte"

beforeEach(() => {
  vi.clearAllMocks()
  mockColdClient.loadSession.mockReset()
})

describe("AgentSession budget — lifecycle boundaries", () => {
  it("#enterSession with same sessionId does not reset budget", () => {
    const session = new AgentSession()
    session._setSessionContextForTest({
      sessionId: "s-same",
      cwd: "/tmp",
      cliKind: "opencode",
    })
    session.budget.contextUsage = { used: 42, size: 100, cost: undefined }
    session.budget.quota = { provider: "p", windows: [] }

    session._setSessionContextForTest({
      sessionId: "s-same",
      cwd: "/tmp/other",
      cliKind: "opencode",
    })

    expect(session.budget.contextUsage?.used).toBe(42)
    expect(session.budget.quota?.provider).toBe("p")
  })

  it("session identity change via #enterSession resets budget", () => {
    const session = new AgentSession()
    session._setSessionContextForTest({
      sessionId: "s-a",
      cwd: "/tmp",
      cliKind: "opencode",
    })
    session.budget.contextUsage = { used: 10, size: 100, cost: undefined }
    session.budget.quotaLoading = true

    session._setSessionContextForTest({
      sessionId: "s-b",
      cwd: "/tmp",
      cliKind: "opencode",
    })

    expect(session.budget.contextUsage).toBeNull()
    expect(session.budget.quota).toBeNull()
    expect(session.budget.quotaLoading).toBe(false)
  })

  it("#cleanup({ keepContext: true }) clears budget but keeps sessionId", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({
      sessionId: "sess-existing",
      cwd: "/tmp/project",
      cliKind: "opencode",
    })
    session.agentId = "agent-old"
    session.budget.contextUsage = { used: 99, size: 200, cost: undefined }
    session.budget.quota = { provider: "p", windows: [{ used: 1, limit: 10 }] }
    session.budget.quotaLoading = true

    mockColdClient.loadSession.mockRejectedValueOnce(new Error("Failed to fetch"))

    await session.loadSession(
      { sessionId: "sess-existing", cwd: "/tmp/project", cliKind: "opencode" },
      { preserveContextOnError: true },
    )

    expect(session._getSessionIdForTest()).toBe("sess-existing")
    expect(session.budget.contextUsage).toBeNull()
    expect(session.budget.quota).toBeNull()
    expect(session.budget.quotaLoading).toBe(false)
    expect(vi.mocked(deleteAgent)).not.toHaveBeenCalled()
  })
})
