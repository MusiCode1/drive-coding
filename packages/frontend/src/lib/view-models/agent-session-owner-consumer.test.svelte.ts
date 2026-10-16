/**
 * B4 consumer proofs — AgentSession must stay wired to Connection.close and pending IO.
 */

import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { HttpConnection } from "$lib/session/http-connection"
import { WsConnection } from "$lib/session/ws-connection"
import * as pendingModule from "$lib/view-models/agent-session-pending"

const mockClient: AcpClient = {
  conn: {} as AcpClient["conn"],
  capabilities: {} as AcpClient["capabilities"],
  newSession: vi.fn().mockResolvedValue({ sessionId: "owner-consumer" }),
  loadSession: vi.fn().mockResolvedValue({}),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  prompt: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  setSessionConfigOption: vi.fn(),
  setSessionMode: vi.fn(),
  setSessionModel: vi.fn(),
  extMethod: vi.fn().mockResolvedValue({ ok: true }),
  authMethods: [],
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
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-owner-consumer" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  releaseConnection: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/adapters/ext", () => ({
  createExtClient: vi.fn(() => ({})),
}))

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })

import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { AgentSession } from "./agent-session.svelte"

describe("AgentSession owner consumer mutations", () => {
  beforeEach(() => {
    ;(mockClient.close as ReturnType<typeof vi.fn>).mockClear()
  })

  it("detach closes the WS client through Connection.close (no-op close breaks wiring)", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "claude" })
    session._setStatusForTest("connected")
    const closeSpy = vi.spyOn(WsConnection.prototype, "close").mockImplementation(() => {})
    try {
      session.detach()
      expect(mockClient.close).not.toHaveBeenCalled()
    } finally {
      closeSpy.mockRestore()
    }
    const session2 = new AgentSession()
    await session2.attach({ cwd: "/tmp", cliKind: "claude" })
    session2.detach()
    expect(mockClient.close).toHaveBeenCalled()
  })

  it("leaveRunning cancels pending through pending helper (disconnected cancel breaks leave)", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "claude" })
    session.pendingPermission = {
      params: {
        toolCallId: "t",
        title: "t",
        options: [{ optionId: "o", kind: "allow_once", name: "o" }],
      },
      resolve: vi.fn(),
    }
    const cancelSpy = vi.spyOn(pendingModule, "cancelPendingDialogs").mockImplementation(() => {})
    try {
      await session.leaveRunning()
      expect(session.pendingPermission).not.toBeNull()
    } finally {
      cancelSpy.mockRestore()
    }
    session.pendingPermission = {
      params: {
        toolCallId: "t2",
        title: "t2",
        options: [{ optionId: "o", kind: "allow_once", name: "o" }],
      },
      resolve: vi.fn(),
    }
    await session.leaveRunning()
    expect(session.pendingPermission).toBeNull()
  })

  it("remote detach closes injected view via HttpConnection.close", async () => {
    const view = new MockSessionView()
    view.connect("remote-owner")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")
    agent._setSessionContextForTest({
      sessionId: "remote-owner",
      cwd: "/a",
      cliKind: "claude",
    })
    const closeSpy = vi.spyOn(HttpConnection.prototype, "close").mockImplementation(() => {})
    try {
      agent.detach()
      expect(view.closeMock).not.toHaveBeenCalled()
    } finally {
      closeSpy.mockRestore()
    }
    const view2 = new MockSessionView()
    view2.connect("remote-owner-2")
    const agent2 = new AgentSession({ view: view2 })
    agent2._setStatusForTest("connected")
    agent2._setSessionContextForTest({
      sessionId: "remote-owner-2",
      cwd: "/a",
      cliKind: "claude",
    })
    agent2.detach()
    expect(view2.closeMock).toHaveBeenCalled()
  })
})
