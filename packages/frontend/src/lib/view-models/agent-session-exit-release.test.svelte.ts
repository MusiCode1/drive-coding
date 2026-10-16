/**
 * B4 public exit timeline — release (DELETE) vs WS preserve (detach only).
 */

import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as agentsApi from "$lib/adapters/agents-api"

const mockClient: AcpClient = {
  conn: {} as AcpClient["conn"],
  capabilities: {} as AcpClient["capabilities"],
  newSession: vi.fn().mockResolvedValue({ sessionId: "exit-release" }),
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
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-exit-ws" }),
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

describe("AgentSession exit release timeline", () => {
  beforeEach(() => {
    vi.mocked(agentsApi.releaseConnection).mockClear()
    vi.mocked(createRemoteView).mockImplementation(async (_opts, hooks) => {
      const view = new MockSessionView()
      view.connect("remote-exit")
      hooks?.onCreated?.(view as unknown as RemoteSessionView)
      hooks?.onReady?.(view as unknown as RemoteSessionView)
      view.hydrate()
      return view as unknown as RemoteSessionView
    })
  })

  it("WS leaveRunning preserve-agent does not DELETE ownership", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "claude" })
    await session.leaveRunning()
    expect(agentsApi.releaseConnection).not.toHaveBeenCalled()
  })

  it("WS pagehide releases captured ownership once", async () => {
    const listeners: Record<string, () => void> = {}
    vi.stubGlobal("window", {
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = fn
      },
    })
    try {
      const session = new AgentSession()
      await session.attach({ cwd: "/tmp", cliKind: "claude" })
      session.bindConnectionRelease()
      listeners.pagehide?.()
      listeners.pagehide?.()
      expect(agentsApi.releaseConnection).toHaveBeenCalledTimes(1)
      expect(agentsApi.releaseConnection).toHaveBeenCalledWith(
        "agent-exit-ws",
        session.connectionId,
      )
    } finally {
      vi.unstubAllGlobals()
      vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
    }
  })

  it("HTTP leaveRunning DELETEs remote ownership", async () => {
    const session = new AgentSession()
    await session.attachRemote({ cwd: "/tmp", cliKind: "claude" })
    await session.leaveRunning()
    expect(agentsApi.releaseConnection).toHaveBeenCalledTimes(1)
    expect(agentsApi.releaseConnection).toHaveBeenCalledWith("agent-exit-ws", session.connectionId)
  })
})
