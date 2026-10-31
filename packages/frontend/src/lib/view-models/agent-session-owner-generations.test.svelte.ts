import type { AcpClientCallbacks } from "@drive-coding/provider/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as api from "$lib/adapters/agents-api"
import { LocalSessionView } from "$lib/session/local-session-view"
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { AgentSession } from "./agent-session.svelte"

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((r, j) => {
    resolve = r
    reject = j
  })
  return { promise, resolve, reject }
}
type Gate =
  | "createAgent"
  | "waitForOpen"
  | "createAcpClient"
  | "newSession"
  | "httpConnect"
  | "loadSession"
  | "notify"
let gate: Gate | null = null
let hold = deferred<unknown>()
let entered = deferred<void>()
let callbacks: AcpClientCallbacks[] = []
let sequence = 0
let events: string[] = []
let transports: Array<ReturnType<typeof makeTransport>> = []
let clients: Array<ReturnType<typeof makeClient>> = []
let views: MockSessionView[] = []
let sessions: AgentSession[] = []
function pause<T>(at: Gate, value: T): Promise<T> {
  if (gate === at) {
    gate = null
    entered.resolve()
    return hold.promise.then(() => value)
  }
  return Promise.resolve(value)
}
function buildTransport(id: number, url: string) {
  const t = {
    id,
    url,
    onClose: vi.fn<(callback: (code: number, reason: string) => void) => void>(),
    waitForOpen: vi.fn(() => pause("waitForOpen", undefined)),
    close: vi.fn(() => events.push(`transport${id}.close`)),
    closeAndWait: vi.fn(async () => {
      events.push(`transport${id}.closeAndWait`)
    }),
    sendRaw: vi.fn(() => events.push(`transport${id}.send`)),
  }
  return t
}
function makeTransport(url: string): ReturnType<typeof buildTransport> {
  const transport = buildTransport(transports.length, url)
  transports.push(transport)
  return transport
}
function buildClient(id: number, t: ReturnType<typeof makeTransport>) {
  const c = {
    conn: {},
    capabilities: {},
    authMethods: [],
    newSession: vi.fn(() => pause("newSession", { sessionId: `session${id}` })),
    loadSession: vi.fn(() => pause("loadSession", {})),
    deleteSession: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ sessions: [] })),
    prompt: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(() => {
      events.push(`client${id}.close`)
      t.close()
    }),
    setSessionConfigOption: vi.fn(),
    setSessionMode: vi.fn(),
    setSessionModel: vi.fn(),
    extMethod: vi.fn(async () => ({ ok: true })),
  }
  return c
}
function makeClient(t: ReturnType<typeof makeTransport>): ReturnType<typeof buildClient> {
  const client = buildClient(clients.length, t)
  clients.push(client)
  return client
}
vi.mock("@drive-coding/provider/client", async (original) => ({
  ...(await original<typeof import("@drive-coding/provider/client")>()),
  createAcpClient: vi.fn((t: ReturnType<typeof makeTransport>, cb: AcpClientCallbacks) => {
    callbacks.push(cb)
    return pause("createAcpClient", makeClient(t))
  }),
  createAttachedAcpClient: vi.fn((t: ReturnType<typeof makeTransport>, cb: AcpClientCallbacks) => {
    callbacks.push(cb)
    return makeClient(t)
  }),
}))
vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function mockOwnerTransport(url: string) {
    return makeTransport(url)
  }),
}))
vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn(() =>
    pause("createAgent", { agentId: `agent${sequence++}`, status: "running" }),
  ),
  deleteAgent: vi.fn(async (id: string) => {
    events.push(`delete:${id}`)
  }),
  releaseConnection: vi.fn(async (id: string) => {
    events.push(`release:${id}`)
  }),
  notifySessionAttached: vi.fn(() => pause("notify", undefined)),
  getAgent: vi.fn(async () => null),
  listAgents: vi.fn(async () => []),
}))
vi.mock("$lib/adapters/ext", () => ({ createExtClient: vi.fn(() => ({})) }))
vi.mock("$lib/session/create-session-view", () => ({
  createRemoteView: vi.fn(
    async (
      opts: { agentId: string },
      hooks?: {
        onCreated?: (view: MockSessionView) => void
        onReady?: (view: MockSessionView) => unknown
      },
    ) => {
      const v = new MockSessionView()
      v.connect(`http:${opts.agentId}`)
      views.push(v)
      hooks?.onCreated?.(v)
      const connected = await pause("httpConnect", v)
      hooks?.onReady?.(connected)
      connected.hydrate()
      return connected
    },
  ),
}))
const input = { cwd: "/synthetic", cliKind: "claude" }
function session() {
  const s = new AgentSession()
  sessions.push(s)
  return s
}
function state(s: AgentSession) {
  return { status: s.status, error: s.error, agentId: s.agentId, sessionId: s.sessionId }
}
beforeEach(() => {
  gate = null
  hold = deferred()
  entered = deferred()
  sequence = 0
  callbacks = []
  events = []
  transports = []
  clients = []
  views = []
  sessions = []
  vi.clearAllMocks()
  vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
})
afterEach(() => {
  for (const s of sessions) s.detach()
  vi.unstubAllGlobals()
})

describe("Calev entered-boundary late outcomes", () => {
  for (const boundary of [
    "createAgent",
    "waitForOpen",
    "createAcpClient",
    "newSession",
    "notify",
  ] as const)
    for (const outcome of ["resolve", "reject"] as const) {
      it(`WS ${boundary} ${outcome} after detach and distinct new connection`, async () => {
        gate = boundary
        const s = session()
        const old = s.attach(input)
        await entered.promise
        expect(api.createAgent).toHaveBeenCalledTimes(1)
        if (boundary !== "createAgent") expect(s.agentId).toBe("agent0")
        s.detach()
        await s.attach(input)
        const stable = state(s)
        const newClient = present(clients.at(-1))
        const newTransport = present(transports.at(-1))
        expect(stable.status).toBe("connected")
        expect(stable.agentId).toBe("agent1")
        const beforeNew = [newClient.close.mock.calls.length, newTransport.close.mock.calls.length]
        if (outcome === "resolve") hold.resolve(undefined)
        else hold.reject(new Error("old controlled rejection"))
        await old
        await Promise.resolve()
        expect.soft(state(s)).toEqual(stable)
        expect
          .soft([newClient.close.mock.calls.length, newTransport.close.mock.calls.length])
          .toEqual(beforeNew)
        if (boundary === "createAgent") {
          expect.soft(transports).toHaveLength(1)
          expect.soft(clients).toHaveLength(1)
        }
        const expectedDeletes = boundary === "createAgent" && outcome === "reject" ? 0 : 1
        expect
          .soft(vi.mocked(api.deleteAgent).mock.calls.filter(([id]) => id === "agent0"))
          .toHaveLength(expectedDeletes)
        for (const t of transports.filter((t) => t !== newTransport))
          expect.soft(t.close.mock.calls.length).toBe(1)
        for (const c of clients.filter((c) => c !== newClient))
          expect.soft(c.close.mock.calls.length).toBeLessThanOrEqual(1)
      })
    }
  for (const existing of [false, true])
    for (const outcome of ["resolve", "reject"] as const) {
      it(`HTTP connect ${outcome} existing=${existing} captured before await`, async () => {
        gate = "httpConnect"
        const s = session()
        const old = existing
          ? s.attachRemoteToLiveAgent({ ...input, agentId: "existing0" })
          : s.attachRemote(input)
        await entered.promise
        expect(views).toHaveLength(1)
        const oldView = present(views[0])
        s.detach()
        expect.soft(oldView.closeMock).toHaveBeenCalledTimes(1)
        await s.attachRemote(input)
        const stable = state(s)
        const nextView = present(views[1])
        if (outcome === "resolve") hold.resolve(undefined)
        else hold.reject(new Error("old connect rejection"))
        await old
        await Promise.resolve()
        expect.soft(state(s)).toEqual(stable)
        expect.soft(nextView.closeMock).not.toHaveBeenCalled()
        expect.soft(oldView.closeMock).toHaveBeenCalledTimes(1)
        // Explicit detach ends an existing agent; replacement must never delete the new agent.
        expect
          .soft(
            vi
              .mocked(api.deleteAgent)
              .mock.calls.filter(([id]) => id === (existing ? "existing0" : "agent0")),
          )
          .toHaveLength(1)
        expect
          .soft(vi.mocked(api.deleteAgent).mock.calls.filter(([id]) => id === stable.agentId))
          .toHaveLength(0)
      })
    }
  it("WS repeated detach closes one client/transport generation once", async () => {
    const s = session()
    await s.attach(input)
    for (let i = 0; i < 10; i++) s.detach()
    expect.soft(present(clients[0]).close).toHaveBeenCalledTimes(1)
    expect.soft(present(transports[0]).close).toHaveBeenCalledTimes(1)
    expect(api.deleteAgent).toHaveBeenCalledTimes(1)
  })
})

describe("Calev public load ownership", () => {
  for (const boundary of [
    "createAgent",
    "waitForOpen",
    "createAcpClient",
    "loadSession",
    "notify",
  ] as const)
    for (const outcome of ["resolve", "reject"] as const) {
      it(`load ${boundary} ${outcome} cannot replace new owner`, async () => {
        gate = boundary
        const s = session()
        const old = s.loadSession({ ...input, sessionId: "loaded-old" })
        await entered.promise
        s.detach()
        await s.attach(input)
        const stable = state(s)
        const newClient = present(clients.at(-1))
        const before = newClient.close.mock.calls.length
        if (outcome === "resolve") hold.resolve(undefined)
        else hold.reject(new Error("old load rejection"))
        await old
        expect.soft(state(s)).toEqual(stable)
        expect.soft(newClient.close.mock.calls.length).toBe(before)
        if (!(boundary === "createAgent" && outcome === "reject"))
          expect
            .soft(vi.mocked(api.deleteAgent).mock.calls.filter(([id]) => id === "agent0"))
            .toHaveLength(1)
      })
    }
  it("load success pagehide releases captured identity exactly once", async () => {
    const s = session()
    await s.loadSession({ ...input, sessionId: "loaded" })
    expect(s.status).toBe("connected")
    s.releaseConnection()
    s.releaseConnection()
    expect(api.releaseConnection).toHaveBeenCalledExactlyOnceWith("agent0", s.connectionId)
  })
})

describe("Calev exit wire parity and stale callbacks", () => {
  for (const protocol of ["WS", "HTTP"] as const)
    for (const exit of ["navigate", "leave", "detach", "delete"] as const) {
      it(`${protocol} ${exit} both pending timeline`, async () => {
        const s = session()
        if (protocol === "WS") await s.attach(input)
        else await s.attachRemote(input)
        s.pendingPermission = {
          params: { sessionId: present(s.sessionId), toolCall: { toolCallId: "t" }, options: [] },
          resolve: vi.fn((r) => events.push(`permission:${JSON.stringify(r)}`)),
        }
        s.pendingElicitation = {
          params: {
            requestId: 0,
            mode: "form",
            message: "synthetic",
            requestedSchema: { type: "object", properties: {} },
          },
          resolve: vi.fn((r) => events.push(`elicitation:${JSON.stringify(r)}`)),
        }
        if (protocol === "HTTP")
          present(views[0]).closeMock.mockImplementation(async () => {
            events.push("view.close")
          })
        if (exit === "leave") {
          const p = s.leaveRunning()
          if (protocol === "WS") expect(events).toHaveLength(2)
          await p
        } else if (exit === "navigate") {
          s.notifySessionNavigatedAway()
          if (protocol === "WS") expect(events).toHaveLength(2)
          await new Promise((r) => setTimeout(r, 5))
        } else if (exit === "delete") expect(await s.deleteSession(present(s.sessionId))).toBe(true)
        else s.detach()
        expect(s.pendingPermission).toBeNull()
        expect(s.pendingElicitation).toBeNull()
        expect(s.status).toBe("idle")
        if (protocol === "WS") {
          expect(events[0]).toContain("permission:")
          expect(events[1]).toContain("elicitation:")
        } else if (exit === "leave" || exit === "navigate") {
          expect(events.some((e) => e.includes("permission:"))).toBe(false)
          expect(events.some((e) => e.includes("elicitation:"))).toBe(false)
        }
        const preserve = exit === "leave" || exit === "navigate"
        expect(api.deleteAgent).toHaveBeenCalledTimes(preserve ? 0 : 1)
        if (protocol === "HTTP")
          expect(api.releaseConnection).toHaveBeenCalledTimes(preserve ? 1 : 0)
        else {
          expect(present(transports[0]).sendRaw).toHaveBeenCalledTimes(preserve ? 1 : 0)
          expect(present(clients[0]).close).toHaveBeenCalled()
        }
      })
    }
  it("old transport close does not write new UI", async () => {
    const s = session()
    await s.attach(input)
    const old = present(transports[0])
    s.detach()
    await s.attach(input)
    const stable = state(s)
    for (const [cb] of old.onClose.mock.calls) cb(4409, "old")
    await Promise.resolve()
    expect(state(s)).toEqual(stable)
  })
  it("old ACP callbacks cannot recreate pending in new connection", async () => {
    const s = session()
    await s.attach(input)
    const old = present(callbacks[0])
    s.detach()
    await s.attach(input)
    void present(old.onRequestPermission)({
      sessionId: "session0",
      toolCall: { toolCallId: "old" },
      options: [],
    })
    void present(old.onCreateElicitation)({
      requestId: 0,
      mode: "form",
      message: "old",
      requestedSchema: { type: "object", properties: {} },
    })
    expect.soft(s.pendingPermission).toBeNull()
    expect.soft(s.pendingElicitation).toBeNull()
  })
  it("cold recovery retry retains owner/controller and releases replacement identity", async () => {
    const s = session()
    await s.attach(input)
    const original = s.sessionId
    gate = "loadSession"
    hold = deferred()
    entered = deferred()
    const retry = s.reconnect()
    await entered.promise
    hold.reject(new Error("cold replay failure"))
    await retry
    expect(s.status).toBe("disconnected")
    expect(s.sessionId).toBe(original)
    expect(s.agentId).toBe("agent0")
    await s.reconnect()
    expect(s.status).toBe("connected")
    expect(s.agentId).toBe("agent2")
    expect(transports).toHaveLength(3)
    s.releaseConnection()
    expect(api.releaseConnection).toHaveBeenLastCalledWith("agent2", s.connectionId)
  })
  it("failed new HTTP attach deletes created agent once", async () => {
    gate = "httpConnect"
    const s = session()
    const p = s.attachRemote(input)
    await entered.promise
    hold.reject(new Error("current connect failed"))
    await p
    expect(api.deleteAgent).toHaveBeenCalledExactlyOnceWith("agent0")
    expect(s.status).toBe("error")
  })
  it("failed existing HTTP attach preserves existing agent", async () => {
    gate = "httpConnect"
    const s = session()
    const p = s.attachRemoteToLiveAgent({ ...input, agentId: "existing" })
    await entered.promise
    hold.reject(new Error("current connect failed"))
    await p
    expect(api.deleteAgent).not.toHaveBeenCalled()
    expect(s.agentId).toBeNull()
  })
  it("warm existing attach then exit closes its adopted client", async () => {
    const s = session()
    await s.attachToLiveAgent({ ...input, sessionId: "existing-session", agentId: "existing" })
    expect(s.status).toBe("connected")
    expect(api.createAgent).not.toHaveBeenCalled()
    s.detach()
    expect(present(clients[0]).close).toHaveBeenCalled()
  })
  it("throwing sendRaw still closes and preserves agent", async () => {
    const s = session()
    await s.attach(input)
    present(transports[0]).sendRaw.mockImplementation(() => {
      throw new Error("wire send failed")
    })
    await s.leaveRunning()
    expect(present(clients[0]).close).toHaveBeenCalled()
    expect(api.deleteAgent).not.toHaveBeenCalled()
    expect(s.status).toBe("idle")
  })
  it("DI without agent closes view exactly once", () => {
    const view = new MockSessionView()
    const s = new AgentSession({ view })
    sessions.push(s)
    s.detach()
    s.detach()
    expect(view.closeMock).toHaveBeenCalledTimes(1)
    expect(api.deleteAgent).not.toHaveBeenCalled()
  })
})

for (const outcome of ["resolve", "reject"] as const)
  it(`HTTP createAgent ${outcome} after exit`, async () => {
    gate = "createAgent"
    const s = session()
    const old = s.attachRemote(input)
    await entered.promise
    s.detach()
    await s.attachRemote(input)
    const stable = state(s)
    if (outcome === "resolve") hold.resolve(undefined)
    else hold.reject(new Error("old creation"))
    await old
    expect(state(s)).toEqual(stable)
    expect(vi.mocked(api.deleteAgent).mock.calls.filter(([id]) => id === "agent0")).toHaveLength(
      outcome === "resolve" ? 1 : 0,
    )
    expect(views).toHaveLength(1)
  })
it("HTTP late-view mutation consumer retains new session identity", async () => {
  gate = "httpConnect"
  const s = session()
  const old = s.attachRemote(input)
  await entered.promise
  s.detach()
  await s.attachRemote(input)
  const stable = state(s)
  hold.resolve(undefined)
  await old
  expect(state(s)).toEqual(stable)
  expect(present(views[1]).closeMock).not.toHaveBeenCalled()
})

it("warm failure disposes view without closing client before exit", async () => {
  gate = "loadSession"
  const s = session()
  const p = s.attachToLiveAgent({ ...input, agentId: "existing", sessionId: "saved" })
  await entered.promise
  hold.reject(new Error("warm replay failed"))
  await p
  expect(present(clients[0]).close).not.toHaveBeenCalled()
  expect(api.deleteAgent).not.toHaveBeenCalled()
  expect(s.status).toBe("error")
})

for (const replacement of ["new-owner", "same-owner"] as const) {
  it(`all stale ACP callbacks stop before the tee after ${replacement}`, async () => {
    const observed = [{ update: vi.fn<() => void>(), ext: vi.fn<() => void>() }]
    const ingest = LocalSessionView.prototype.ingestUpdate
    const spy = vi.spyOn(LocalSessionView.prototype, "ingestUpdate").mockImplementation(function (
      this: LocalSessionView,
      raw: unknown,
    ) {
      let counters = observed[0]
      if (!counters) {
        counters = { update: vi.fn<() => void>(), ext: vi.fn<() => void>() }
        observed.push(counters)
      }
      if ((raw as { sessionUpdate?: string }).sessionUpdate === "_drive/ext_notification")
        counters.ext()
      else counters.update()
      return ingest.call(this, raw)
    })
    try {
      const s = session()
      await s.attach(input)
      const old = callbacks[0]
      const observer = observed[0]
      if (!old || !observer) throw new Error("missing old callbacks")
      if (replacement === "new-owner") {
        s.detach()
        await s.attach(input)
      } else {
        await s.reconnect()
      }
      const stable = state(s)
      const bubbles = JSON.stringify(s.bubbles)
      observer.update.mockClear()
      observer.ext.mockClear()
      old.onUpdate({
        sessionId: "session0",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "stale-message" },
        },
      })
      old.onExtNotification?.("_drive/capabilities", { stale: true })
      expect(observer.update).not.toHaveBeenCalled()
      expect(observer.ext).not.toHaveBeenCalled()
      await expect(
        old.onRequestPermission?.({
          sessionId: "session0",
          toolCall: { toolCallId: "old" },
          options: [],
        }),
      ).resolves.toEqual({ outcome: { outcome: "cancelled" } })
      await expect(
        old.onCreateElicitation?.({
          requestId: 0,
          mode: "form",
          message: "old",
          requestedSchema: { type: "object", properties: {} },
        }),
      ).resolves.toEqual({ action: "cancel" })
      expect(state(s)).toEqual(stable)
      expect(JSON.stringify(s.bubbles)).toBe(bubbles)
      expect(s.pendingPermission).toBeNull()
      expect(s.pendingElicitation).toBeNull()
      expect(observer.update).not.toHaveBeenCalled()
      expect(observer.ext).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
}

for (const boundary of ["waitForOpen", "createAcpClient", "loadSession", "notify"] as const) {
  it(`load releases its published identity once while ${boundary} is pending`, async () => {
    gate = boundary
    const s = session()
    const loading = s.loadSession({ ...input, sessionId: "saved" })
    await entered.promise
    s.releaseConnection()
    s.releaseConnection()
    expect(api.releaseConnection).toHaveBeenCalledExactlyOnceWith("agent0", s.connectionId)
    hold.resolve(undefined)
    await loading
    expect(s.status).toBe("connected")
    s.releaseConnection()
    expect(api.releaseConnection).toHaveBeenCalledTimes(1)
  })
}

function present<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("missing test fixture")
  return value
}

it("warm adoption of the same agent opens a new release generation on the same owner", async () => {
  const s = session()
  await s.attach(input)
  const agentId = present(s.agentId)
  const sessionId = present(s.sessionId)
  s.releaseConnection()
  s.releaseConnection()
  expect(api.releaseConnection).toHaveBeenCalledExactlyOnceWith(agentId, s.connectionId)
  vi.mocked(api.listAgents).mockResolvedValueOnce([
    {
      id: agentId,
      acpSessionId: sessionId,
      cwd: input.cwd,
      cliKind: "claude",
      modelOverride: null,
      status: "ready",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ])
  await s.reconnect()
  expect(s.status).toBe("connected")
  expect(s.agentId).toBe(agentId)
  expect(s.sessionId).toBe(sessionId)
  // A new attached client and no new allocation prove warm reuse of the same owner.
  expect(api.createAgent).toHaveBeenCalledTimes(1)
  expect(clients).toHaveLength(2)
  expect(api.deleteAgent).not.toHaveBeenCalled()
  s.releaseConnection()
  s.releaseConnection()
  expect(api.releaseConnection).toHaveBeenCalledTimes(2)
  expect(api.releaseConnection).toHaveBeenNthCalledWith(2, agentId, s.connectionId)
})

it("initial existing warm publication and adoption share one release generation", async () => {
  gate = "loadSession"
  const s = session()
  const attaching = s.attachToLiveAgent({ ...input, agentId: "existing0", sessionId: "saved" })
  await entered.promise
  s.releaseConnection()
  s.releaseConnection()
  expect(api.releaseConnection).toHaveBeenCalledExactlyOnceWith("existing0", s.connectionId)
  hold.resolve(undefined)
  await attaching
  expect(s.status).toBe("connected")
  s.releaseConnection()
  s.releaseConnection()
  expect(api.releaseConnection).toHaveBeenCalledTimes(1)
})
