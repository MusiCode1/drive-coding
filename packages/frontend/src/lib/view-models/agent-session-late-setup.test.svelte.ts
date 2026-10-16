/**
 * B4 setup guards — controlled deferred I/O (no sleep timing).
 */

import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CreateAgentResponse } from "$lib/adapters/agents-api"
import * as agentsApi from "$lib/adapters/agents-api"
import type { RemoteSessionView } from "$lib/session/remote-session-view"

function agentCreated(agentId: string): CreateAgentResponse {
  return { agentId, status: "running" }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const mockClient: AcpClient = {
  conn: {} as AcpClient["conn"],
  capabilities: {} as AcpClient["capabilities"],
  newSession: vi.fn(),
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

let waitForOpenDeferred = deferred<void>()
let createAcpDeferred = deferred<AcpClient>()
let newSessionDeferred = deferred<{ sessionId: string }>()

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(() => createAcpDeferred.promise),
  }
})

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn(() => waitForOpenDeferred.promise),
      close: vi.fn(),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
      sendRaw: vi.fn(),
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn(),
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
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { AgentSession } from "./agent-session.svelte"

async function remoteViewStub(connectId: string): Promise<RemoteSessionView> {
  const view = new MockSessionView()
  view.connect(connectId)
  return view as unknown as RemoteSessionView
}

describe("AgentSession late setup (deferred I/O)", () => {
  beforeEach(() => {
    waitForOpenDeferred = deferred<void>()
    createAcpDeferred = deferred<AcpClient>()
    newSessionDeferred = deferred<{ sessionId: string }>()
    vi.mocked(mockClient.newSession).mockImplementation(() => newSessionDeferred.promise)
    vi.mocked(agentsApi.deleteAgent).mockClear()
    vi.mocked(agentsApi.createAgent).mockClear()
    vi.mocked(createRemoteView).mockClear()
  })

  it("stale createAgent after detach deletes exactly once and never connects", async () => {
    const agentDeferred = deferred<CreateAgentResponse>()
    vi.mocked(agentsApi.createAgent).mockReturnValueOnce(agentDeferred.promise)
    const session = new AgentSession()
    const attachPromise = session.attach({ cwd: "/tmp", cliKind: "claude" })
    agentDeferred.resolve(agentCreated("agent-stale-create"))
    session.detach()
    try {
      // A stale allocation must be discarded before opening another transport.
      await vi.waitFor(() =>
        expect(agentsApi.deleteAgent).toHaveBeenCalledWith("agent-stale-create"),
      )
    } finally {
      waitForOpenDeferred.resolve()
      createAcpDeferred.resolve(mockClient)
      newSessionDeferred.resolve({ sessionId: "stale-session" })
      await attachPromise
    }
    expect(session.status).not.toBe("connected")
    expect(agentsApi.deleteAgent).toHaveBeenCalledTimes(1)
    expect(agentsApi.deleteAgent).toHaveBeenCalledWith("agent-stale-create")
  })

  it("stale waitForOpen after attachRemote deletes first agent once", async () => {
    vi.mocked(agentsApi.createAgent)
      .mockResolvedValueOnce(agentCreated("agent-first"))
      .mockResolvedValueOnce(agentCreated("agent-remote"))
    vi.mocked(createRemoteView).mockImplementation(() => remoteViewStub("remote-after-ws"))
    const session = new AgentSession()
    const first = session.attach({ cwd: "/tmp", cliKind: "claude" })
    session.detach()
    await session.attachRemote({ cwd: "/other", cliKind: "claude" })
    waitForOpenDeferred.resolve()
    createAcpDeferred.resolve(mockClient)
    newSessionDeferred.resolve({ sessionId: "sess-stale" })
    await first
    expect(session.isRemoteView).toBe(true)
    expect(agentsApi.deleteAgent).toHaveBeenCalledTimes(1)
    expect(agentsApi.deleteAgent).toHaveBeenCalledWith("agent-first")
  })

  it("detach then attachRemote while WS waitForOpen pending discards stale WS agent", async () => {
    vi.mocked(agentsApi.createAgent)
      .mockResolvedValueOnce(agentCreated("agent-ws-stale"))
      .mockResolvedValueOnce(agentCreated("agent-remote"))
    vi.mocked(createRemoteView).mockImplementation(() => remoteViewStub("remote-win"))
    const session = new AgentSession()
    const wsPending = session.attach({ cwd: "/tmp", cliKind: "claude" })
    session.detach()
    await session.attachRemote({ cwd: "/remote", cliKind: "claude" })
    waitForOpenDeferred.resolve()
    createAcpDeferred.resolve(mockClient)
    newSessionDeferred.resolve({ sessionId: "sess-stale-ws" })
    await wsPending
    expect(session.isRemoteView).toBe(true)
    expect(agentsApi.deleteAgent).toHaveBeenCalledTimes(1)
    expect(agentsApi.deleteAgent).toHaveBeenCalledWith("agent-ws-stale")
  })

  it("attachRemote deferred createRemoteView after detach closes stale view", async () => {
    const remoteDef = deferred<RemoteSessionView>()
    vi.mocked(agentsApi.createAgent).mockResolvedValueOnce(agentCreated("agent-http-late"))
    vi.mocked(createRemoteView).mockImplementationOnce(() => remoteDef.promise)
    const session = new AgentSession()
    const pending = session.attachRemote({ cwd: "/tmp", cliKind: "claude" })
    await vi.waitFor(() => expect(vi.mocked(createRemoteView).mock.calls.length).toBeGreaterThan(0))
    session.detach()
    const staleView = new MockSessionView()
    staleView.connect("stale-http")
    remoteDef.resolve(staleView as unknown as RemoteSessionView)
    await pending
    expect(staleView.closeMock).toHaveBeenCalled()
  })

  it("existing HTTP agent failure does not deleteAgent", async () => {
    vi.mocked(createRemoteView).mockRejectedValueOnce(new Error("connect failed"))
    const session = new AgentSession()
    await session.attachRemoteToLiveAgent({
      agentId: "existing-live",
      cwd: "/x",
      cliKind: "claude",
    })
    expect(agentsApi.deleteAgent).not.toHaveBeenCalled()
  })
})
