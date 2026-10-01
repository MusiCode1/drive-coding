/**
 * agent-session.list-sessions-local.test.svelte.ts — local branch of listSessions (sessions-cache-scope C2).
 */
import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockClient: AcpClient = {
  conn: {} as AcpClient["conn"],
  capabilities: {} as AcpClient["capabilities"],
  newSession: vi.fn().mockResolvedValue({ sessionId: "list-local-test" }),
  loadSession: vi.fn().mockResolvedValue({}),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  deleteSession: vi.fn().mockResolvedValue(undefined),
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
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-list-local" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/adapters/ext", () => ({
  createExtClient: vi.fn(() => ({
    setThinkingTokens: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" })

import { AgentSession } from "./agent-session.svelte"

describe("AgentSession.listSessions — local ACP path", () => {
  let session: AgentSession

  beforeEach(async () => {
    ;(mockClient.listSessions as ReturnType<typeof vi.fn>).mockReset()
    session = new AgentSession()
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })
  })

  it("maps raw sessions through normalizeSessionInfo", async () => {
    ;(mockClient.listSessions as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessions: [{ sessionId: "s-1", cwd: "/a", title: "T", updatedAt: "2026-01-01" }],
    })

    await session.listSessions()

    expect(session.sessionsCache.sessions).toEqual([
      { sessionId: "s-1", cwd: "/a", title: "T", updatedAt: "2026-01-01" },
    ])
    expect(session.sessionsCache.error).toBeNull()
  })

  it("missing sessions key yields empty list (?? [] guard)", async () => {
    ;(mockClient.listSessions as ReturnType<typeof vi.fn>).mockResolvedValueOnce({})

    await session.listSessions()

    expect(session.sessionsCache.sessions).toEqual([])
  })
})
