/**
 * B4 consumer proofs — AgentSession stays wired to Connection.close and pending IO.
 */

import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as agentsApi from "$lib/adapters/agents-api"

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

vi.mock("$lib/session/create-session-view", () => ({
  createRemoteView: vi.fn(),
}))

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })

import { createRemoteView } from "$lib/session/create-session-view"
import type { RemoteSessionView } from "$lib/session/remote-session-view"
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { AgentSession } from "./agent-session.svelte"

function permissionParams() {
  return {
    sessionId: "owner-consumer",
    toolCall: { toolCallId: "t1", title: "Write file" },
    options: [{ optionId: "o", kind: "allow_once" as const, name: "Allow" }],
  }
}

describe("AgentSession owner consumer wiring", () => {
  beforeEach(() => {
    vi.mocked(mockClient.close).mockClear()
    vi.mocked(agentsApi.releaseConnection).mockClear()
    vi.mocked(createRemoteView).mockImplementation(async () => {
      const view = new MockSessionView()
      view.connect("remote-sess")
      return view as unknown as RemoteSessionView
    })
  })

  it("detach closes the WS client through Connection.close", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "claude" })
    session._setStatusForTest("connected")
    session.detach()
    expect(mockClient.close).toHaveBeenCalled()
  })

  it("leaveRunning cancels pending permission through pending helper", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "claude" })
    session.pendingPermission = {
      requestId: 1,
      params: permissionParams(),
      resolve: vi.fn(),
    }
    await session.leaveRunning()
    expect(session.pendingPermission).toBeNull()
  })

  it("DI view closes via HttpConnection on detach", async () => {
    const view = new MockSessionView()
    view.connect("remote-owner")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")
    agent._setSessionContextForTest({
      sessionId: "remote-owner",
      cwd: "/a",
      cliKind: "claude",
    })
    agent.detach()
    expect(view.closeMock).toHaveBeenCalled()
  })

  it("attachRemote release uses captured identity on pagehide", async () => {
    const listeners: Record<string, () => void> = {}
    vi.stubGlobal("window", {
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = fn
      },
    })
    try {
      const session = new AgentSession()
      await session.attachRemote({ cwd: "/tmp", cliKind: "claude" })
      session.bindConnectionRelease()
      listeners.pagehide?.()
      expect(agentsApi.releaseConnection).toHaveBeenCalledWith(
        "agent-owner-consumer",
        session.connectionId,
      )
    } finally {
      vi.unstubAllGlobals()
      vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
    }
  })
})
