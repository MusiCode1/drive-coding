import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as api from "$lib/adapters/agents-api"
import { createRemoteView } from "$lib/session/create-session-view"
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { AgentSession } from "./agent-session.svelte"

const h = vi.hoisted(() => ({
  clients: [] as AcpClient[],
  callbacks: [] as AcpClientCallbacks[],
  views: [] as unknown[],
}))
vi.mock("@drive-coding/provider/client", async (actual) => ({
  ...(await actual<typeof import("@drive-coding/provider/client")>()),
  createAcpClient: vi.fn(function createClient(_transport: unknown, callbacks: AcpClientCallbacks) {
    h.callbacks.push(callbacks)
    return Promise.resolve(h.clients.shift())
  }),
}))
vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function transport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))
vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  patchAgent: vi.fn().mockResolvedValue(undefined),
  releaseConnection: vi.fn(),
  listAgents: vi.fn().mockResolvedValue([]),
}))
vi.mock("$lib/session/create-session-view", () => ({ createRemoteView: vi.fn() }))
vi.mock("$lib/session/local-session-view", async (actual) => {
  const mod = await actual<typeof import("$lib/session/local-session-view")>()
  return {
    ...mod,
    LocalSessionView: class extends mod.LocalSessionView {
      constructor(opts: ConstructorParameters<typeof mod.LocalSessionView>[0]) {
        super(opts)
        h.views.push(this)
      }
    },
  }
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function client(id = "same") {
  return {
    newSession: vi.fn().mockResolvedValue({ sessionId: id }),
    loadSession: vi.fn().mockResolvedValue({}),
    setSessionConfigOption: vi.fn().mockResolvedValue({ configOptions: [] }),
    setSessionMode: vi.fn().mockResolvedValue(undefined),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    close: vi.fn(),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    extMethod: vi.fn().mockResolvedValue({}),
    capabilities: {},
    authMethods: [],
    conn: {},
  }
}
const option = (id = "toggle") => ({ id, name: id, type: "boolean", value: false })
function snapshot(s: AgentSession) {
  return JSON.parse(
    JSON.stringify({
      id: s.sessionId,
      agent: s.agentId,
      bubbles: s.bubbles,
      title: s.sessionTitle,
      config: s.config.configOptions,
      modes: s.config.modes,
      models: s.config.models,
      cwd: s.cwd,
      status: s.status,
      error: s.error,
      loading: s.isLoadingHistory,
      turn: s.turnState,
    }),
  )
}
const sessions: AgentSession[] = []
function session(settings?: {
  lastConfig: Record<string, Record<string, string | boolean>>
  setLastConfig: ReturnType<typeof vi.fn>
}) {
  const s = new AgentSession({ settings: settings as never })
  sessions.push(s)
  return s
}
async function attach(s: AgentSession, c = client(), remote = false) {
  h.clients.push(c as unknown as AcpClient)
  if (remote) await s.attachRemote({ cwd: "/replacement", cliKind: "opencode" })
  else await s.attach({ cwd: "/replacement", cliKind: "opencode" })
  expect(s.status).toBe("connected")
  return c
}
beforeEach(() => {
  vi.clearAllMocks()
  h.clients = []
  h.callbacks = []
  h.views = []
  vi.stubGlobal("location", { protocol: "http:", host: "localhost" })
  vi.mocked(api.notifySessionAttached).mockResolvedValue(undefined)
  vi.mocked(createRemoteView).mockImplementation(async (_opts, hooks) => {
    const v = new MockSessionView()
    v.connect("same")
    h.views.push(v)
    hooks?.onCreated?.(v as never)
    hooks?.onReady?.(v as never)
    v.hydrate()
    return v as never
  })
})
afterEach(() => {
  for (const s of sessions.splice(0)) s.detach()
  vi.unstubAllGlobals()
})

describe("public hot operation ownership", () => {
  for (const remote of [false, true])
    for (const operation of ["new", "switch"] as const)
      for (const reject of [false, true]) {
        it(`${remote ? "HTTP" : "WS"} ${operation} stale ${reject ? "reject" : "resolve"} preserves replacement`, async () => {
          const s = session()
          const c = await attach(s, client(), remote)
          const gate = deferred<unknown>()
          const v = h.views.at(-1) as MockSessionView
          if (remote)
            (operation === "new" ? v.newSessionMock : v.loadSessionMock).mockImplementationOnce(
              () => gate.promise as Promise<void>,
            )
          else
            (operation === "new" ? c.newSession : c.loadSession).mockImplementationOnce(
              () => gate.promise,
            )
          const pending =
            operation === "new"
              ? s.newSession({ cwd: "/old", cliKind: "opencode" })
              : s.switchSession({ sessionId: "old", cwd: "/old", cliKind: "opencode" })
          expect(
            remote
              ? operation === "new"
                ? v.newSessionMock
                : v.loadSessionMock
              : operation === "new"
                ? c.newSession
                : c.loadSession,
          ).toHaveBeenCalled()
          s.detach()
          await attach(s, client("replacement"), remote)
          expect(s.isLoadingHistory).toBe(false)
          const before = snapshot(s)
          if (reject) gate.reject(new Error("old rejection"))
          else gate.resolve({ sessionId: "old", configOptions: [option("old")] })
          await pending
          expect(snapshot(s)).toEqual(before)
          if (remote) expect(h.callbacks).toHaveLength(0)
        })
      }
  for (const reject of [false, true])
    for (const initial of [false, true]) {
      it(`same-id ${initial ? "initial restoration" : "manual config"} stale ${reject ? "reject" : "resolve"}`, async () => {
        const settings = {
          lastConfig: { opencode: initial ? { toggle: true, mode: "ask" } : {} } as Record<
            string,
            Record<string, string | boolean>
          >,
          setLastConfig: vi.fn(),
        }
        const c = client()
        c.newSession.mockResolvedValue({
          sessionId: "same",
          configOptions: [option()],
          modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] },
        } as never)
        const gate = deferred<unknown>()
        c.setSessionConfigOption.mockImplementationOnce(() => gate.promise)
        const s = session(settings)
        h.clients.push(c as unknown as AcpClient)
        const attaching = s.attach({ cwd: "/a", cliKind: "opencode" })
        let pending: Promise<void>
        if (initial) {
          pending = attaching
          await vi.waitFor(() => expect(c.setSessionConfigOption).toHaveBeenCalledTimes(1))
        } else {
          await attaching
          pending = s.applyConfigOption("toggle", true)
          expect(c.setSessionConfigOption).toHaveBeenCalledTimes(1)
        }
        const view = h.views.at(-1)
        await s.switchSession({ sessionId: "same", cwd: "/a", cliKind: "opencode" })
        expect(h.views.at(-1)).toBe(view)
        const before = snapshot(s)
        if (reject) gate.reject(new Error("stale config"))
        else gate.resolve({ configOptions: [option("old")] })
        await pending.catch(() => {})
        expect(snapshot(s)).toEqual(before)
        expect(c.close).not.toHaveBeenCalled()
        expect(api.deleteAgent).not.toHaveBeenCalled()
        expect(settings.setLastConfig).not.toHaveBeenCalled()
        expect(c.setSessionMode).not.toHaveBeenCalled()
      })
    }
})

describe("continuations keep the operation that owns them", () => {
  for (const remote of [false, true])
    for (const reject of [false, true]) {
      it(`${remote ? "HTTP" : "WS"} stale finally/catch preserves new loading`, async () => {
        const s = session()
        const c = await attach(s, client(), remote)
        const old = deferred<unknown>()
        const next = deferred<unknown>()
        const v = h.views.at(-1) as MockSessionView
        if (remote) v.loadSessionMock.mockImplementationOnce(() => old.promise)
        else c.loadSession.mockImplementationOnce(() => old.promise)
        const pending = s.switchSession({ sessionId: "old", cwd: "/old", cliKind: "opencode" })
        s.detach()
        const replacement = await attach(s, client("replacement"), remote)
        if (remote)
          (h.views.at(-1) as MockSessionView).loadSessionMock.mockImplementationOnce(
            () => next.promise,
          )
        else replacement.loadSession.mockImplementationOnce(() => next.promise)
        const newer = s.switchSession({ sessionId: "newer", cwd: "/newer", cliKind: "opencode" })
        expect(s.isLoadingHistory).toBe(true)
        const before = snapshot(s)
        if (reject) old.reject(new Error("stale"))
        else old.resolve({})
        await pending
        expect(snapshot(s)).toEqual(before)
        next.resolve({})
        await newer
        expect(s.sessionId).toBe("newer")
        expect(s.isLoadingHistory).toBe(false)
      })
    }
  for (const operation of ["new", "switch"] as const) {
    it(`${operation} delayed notify does not reconnect a newer loading operation`, async () => {
      const settings = { lastConfig: { opencode: { mode: "ask" } }, setLastConfig: vi.fn() }
      const s = session(settings)
      await attach(s)
      const notify = deferred<void>()
      vi.mocked(api.notifySessionAttached).mockImplementationOnce(() => notify.promise)
      const old =
        operation === "new"
          ? s.newSession({ cliKind: "opencode" })
          : s.switchSession({ sessionId: "old", cwd: "/old", cliKind: "opencode" })
      await vi.waitFor(() => expect(api.notifySessionAttached).toHaveBeenCalledTimes(2))
      s.detach()
      const c = await attach(s, client("replacement"))
      const gate = deferred<unknown>()
      c.loadSession.mockImplementationOnce(() => gate.promise)
      const newer = s.switchSession({ sessionId: "new", cwd: "/new", cliKind: "opencode" })
      const before = snapshot(s)
      notify.resolve()
      await old
      expect(snapshot(s)).toEqual(before)
      expect(settings.setLastConfig).not.toHaveBeenCalled()
      gate.resolve({})
      await newer
    })
  }
  it("end callback may replace the owner before RPC", async () => {
    const s = session()
    const c = await attach(s)
    let replacement: Promise<void> | undefined
    const off = s.onSessionEnd(() => {
      off()
      s.detach()
      replacement = attach(s, client("replacement")).then(() => {})
    })
    await s.newSession({ cliKind: "opencode" })
    await replacement
    expect(c.newSession).toHaveBeenCalledTimes(1)
    expect(s.sessionId).toBe("replacement")
    expect(s.status).toBe("connected")
  })
  it("HTTP legitimate reset/adoption during RPC keeps the operation alive", async () => {
    const s = session()
    await attach(s, client(), true)
    const v = h.views.at(-1) as MockSessionView
    const gate = deferred<void>()
    v.newSessionMock.mockImplementationOnce(() => gate.promise)
    const pending = s.newSession({ cwd: "/new", cliKind: "opencode" })
    v.connect("legitimate-new")
    gate.resolve()
    await pending
    expect(s.sessionId).toBe("legitimate-new")
    expect(s.cwd).toBe("/new")
    expect(s.isLoadingHistory).toBe(false)
    expect(s.error).toBeNull()
  })
})

describe("bound config consumers", () => {
  it("current initial WS rejection preserves the original failure path", async () => {
    const settings = { lastConfig: { opencode: { toggle: true } }, setLastConfig: vi.fn() }
    const s = session(settings)
    const c = client()
    c.newSession.mockResolvedValue({ sessionId: "same", configOptions: [option()] } as never)
    c.setSessionConfigOption.mockRejectedValue(new Error("current rejection"))
    h.clients.push(c as unknown as AcpClient)
    await s.attach({ cwd: "/a", cliKind: "opencode" })
    expect(s.status).toBe("error")
    expect(s.error).toContain("current rejection")
    expect(c.close).toHaveBeenCalled()
    expect(settings.setLastConfig).not.toHaveBeenCalled()
  })
  it("current manual rejection propagates", async () => {
    const s = session()
    const c = await attach(s)
    c.setSessionMode.mockRejectedValue(new Error("current rejection"))
    await expect(s.applyConfigOption("mode", "ask")).rejects.toThrow("current rejection")
  })
  for (const remote of [false, true])
    for (const initial of [false, true]) {
      it(`${remote ? "HTTP" : "WS"} ${initial ? "restoration" : "manual"} stale config reject resolves without writing`, async () => {
        const settings = {
          lastConfig: { opencode: initial ? { toggle: true, mode: "ask" } : {} } as Record<
            string,
            Record<string, string | boolean>
          >,
          setLastConfig: vi.fn(),
        }
        const s = session(settings)
        const c = client()
        const gate = deferred<unknown>()
        const entered = deferred<void>()
        c.newSession.mockResolvedValue({ sessionId: "same", configOptions: [option()] } as never)
        if (remote)
          vi.mocked(createRemoteView).mockImplementationOnce(async (_opts, hooks) => {
            const v = new MockSessionView()
            v.connect("same")
            v.state = { ...v.state, configOptions: [option()] as never }
            v.setConfigOptionMock.mockImplementationOnce(() => {
              entered.resolve()
              return gate.promise
            })
            h.views.push(v)
            hooks?.onCreated?.(v as never)
            hooks?.onReady?.(v as never)
            v.hydrate()
            return v as never
          })
        else
          c.setSessionConfigOption.mockImplementationOnce(() => {
            entered.resolve()
            return gate.promise
          })
        h.clients.push(c as unknown as AcpClient)
        const attaching = remote
          ? s.attachRemote({ cwd: "/a", cliKind: "opencode" })
          : s.attach({ cwd: "/a", cliKind: "opencode" })
        let pending: Promise<void>
        if (initial) pending = attaching
        else {
          await attaching
          pending = s.applyConfigOption("toggle", true)
        }
        await entered.promise
        s.detach()
        await attach(s, client("replacement"), remote)
        const before = snapshot(s)
        settings.setLastConfig.mockClear()
        gate.reject(new Error("stale rejection"))
        await expect(pending).resolves.toBeUndefined()
        expect(snapshot(s)).toEqual(before)
        expect(settings.setLastConfig).not.toHaveBeenCalled()
      })
    }
  it("return to a prior id does not revive its old config generation", async () => {
    const settings = { lastConfig: {}, setLastConfig: vi.fn() }
    const s = session(settings)
    const c = await attach(s)
    const gate = deferred<void>()
    c.setSessionMode.mockImplementationOnce(() => gate.promise)
    const pending = s.applyConfigOption("mode", "old")
    await s.switchSession({ sessionId: "other", cwd: "/a", cliKind: "opencode" })
    await s.switchSession({ sessionId: "same", cwd: "/a", cliKind: "opencode" })
    const before = snapshot(s)
    gate.resolve()
    await pending
    expect(snapshot(s)).toEqual(before)
    expect(settings.setLastConfig).not.toHaveBeenCalled()
  })
  it("parallel manual config calls keep the same generation", async () => {
    const settings = { lastConfig: {}, setLastConfig: vi.fn() }
    const s = session(settings)
    const c = await attach(s)
    const first = deferred<void>()
    const second = deferred<void>()
    c.setSessionMode.mockImplementationOnce(() => first.promise)
    c.setSessionModel.mockImplementationOnce(() => second.promise)
    const a = s.applyConfigOption("mode", "ask")
    const b = s.applyConfigOption("model", "m")
    second.resolve()
    await b
    first.resolve()
    await a
    expect(settings.setLastConfig.mock.calls).toEqual([
      ["opencode", "model", "m"],
      ["opencode", "mode", "ask"],
    ])
  })
  for (const remote of [false, true]) {
    it(`${remote ? "HTTP" : "WS"} wire metadata stays live across remembered keys and entries snapshot once`, async () => {
      const settings = {
        lastConfig: { opencode: { toggle: true, mode: "ask" } },
        setLastConfig: vi.fn(),
      }
      const s = session(settings)
      const c = client()
      const gate = deferred<unknown>()
      const entered = deferred<void>()
      c.newSession.mockResolvedValue({ sessionId: "same", configOptions: [option()] } as never)
      if (remote)
        vi.mocked(createRemoteView).mockImplementationOnce(async (_opts, hooks) => {
          const v = new MockSessionView()
          v.connect("same")
          v.state = { ...v.state, configOptions: [option()] as never }
          v.setConfigOptionMock.mockImplementationOnce(() => {
            entered.resolve()
            return gate.promise
          })
          h.views.push(v)
          hooks?.onCreated?.(v as never)
          hooks?.onReady?.(v as never)
          v.hydrate()
          return v as never
        })
      else
        c.setSessionConfigOption.mockImplementationOnce(() => {
          entered.resolve()
          return gate.promise
        })
      h.clients.push(c as unknown as AcpClient)
      const pending = remote
        ? s.attachRemote({ cwd: "/a", cliKind: "opencode" })
        : s.attach({ cwd: "/a", cliKind: "opencode" })
      await entered.promise
      settings.lastConfig.opencode.mode = "changed-after-snapshot"
      const update = { sessionUpdate: "current_mode_update", currentModeId: "ask" }
      // Full mode metadata is delivered through the active view's normal wire reducer.
      if (remote) {
        const v = h.views.at(-1) as MockSessionView
        v.state = {
          ...v.state,
          modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] },
        }
        v.fireUpdate(update)
      } else {
        // availableModes is existing public metadata; the next wire update carries the live current value.
        s.config.modes = { currentModeId: "before", availableModes: [{ id: "ask", name: "Ask" }] }
        h.callbacks.at(-1)?.onUpdate?.({ sessionId: "same", update } as never)
      }
      await vi.waitFor(() => expect(s.config.modes?.currentModeId).toBe("ask"))
      gate.resolve({ configOptions: [] })
      await pending
      const calls = remote ? (h.views.at(-1) as MockSessionView).setModeMock : c.setSessionMode
      expect(calls).toHaveBeenCalledWith(
        ...(remote ? ["ask"] : [{ sessionId: "same", modeId: "ask" }]),
      )
      expect(settings.setLastConfig).toHaveBeenCalledWith("opencode", "mode", "ask")
    })
  }
  it("live disconnected status blocks next remembered key without suppressing completed persistence", async () => {
    const settings = {
      lastConfig: { opencode: { toggle: true, mode: "ask" } },
      setLastConfig: vi.fn(),
    }
    const s = session(settings)
    const c = client()
    const gate = deferred<unknown>()
    const entered = deferred<void>()
    c.newSession.mockResolvedValue({
      sessionId: "same",
      configOptions: [option()],
      modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] },
    } as never)
    c.setSessionConfigOption.mockImplementationOnce(() => {
      entered.resolve()
      return gate.promise
    })
    h.clients.push(c as unknown as AcpClient)
    const pending = s.attach({ cwd: "/a", cliKind: "opencode" })
    await entered.promise
    // Public status is live, but changing it alone does not replace the target.
    s.status = "disconnected"
    gate.resolve({ configOptions: [] })
    await pending
    expect(settings.setLastConfig).toHaveBeenCalledWith("opencode", "toggle", true)
    expect(c.setSessionMode).not.toHaveBeenCalled()
  })
})

describe("current config fallback parity", () => {
  for (const remote of [false, true])
    for (const branch of [
      "id",
      "category-model",
      "category-mode",
      "model",
      "mode",
      "skip",
    ] as const) {
      it(`${remote ? "HTTP" : "WS"} ${branch}`, async () => {
        const settings = { lastConfig: {}, setLastConfig: vi.fn() }
        const s = session(settings)
        const c = await attach(s, client(), remote)
        const v = h.views.at(-1) as MockSessionView
        s.config.configOptions =
          branch === "id"
            ? [option() as never]
            : branch.startsWith("category")
              ? [
                  {
                    id: "real-id",
                    name: "Choice",
                    type: "select",
                    category: branch.slice(9),
                    currentValue: "v",
                    options: [{ value: "v", name: "Value" }],
                  } as never,
                ]
              : []
        const key =
          branch === "id"
            ? "toggle"
            : branch === "skip"
              ? "unknown"
              : branch.replace("category-", "")
        const value = branch === "id" ? true : "v"
        await s.applyConfigOption(key, value)
        if (branch === "skip") expect(settings.setLastConfig).not.toHaveBeenCalled()
        else expect(settings.setLastConfig).toHaveBeenCalledWith("opencode", key, value)
        if (branch === "id" || branch.startsWith("category")) {
          if (remote)
            expect(v.setConfigOptionMock).toHaveBeenCalledWith(
              branch === "id" ? "toggle" : "real-id",
              value,
            )
          else
            expect(c.setSessionConfigOption).toHaveBeenCalledWith({
              sessionId: "same",
              configId: branch === "id" ? "toggle" : "real-id",
              value,
            })
        } else if (branch !== "skip") {
          if (remote)
            expect(branch === "mode" ? v.setModeMock : v.setSessionModelMock).toHaveBeenCalledWith(
              value,
            )
          else
            expect(branch === "mode" ? c.setSessionMode : c.setSessionModel).toHaveBeenCalledWith(
              branch === "mode"
                ? { sessionId: "same", modeId: value }
                : { sessionId: "same", modelId: value },
            )
        }
        if (remote)
          expect(s.config.configOptions).toHaveLength(
            branch === "id" || branch.startsWith("category") ? 1 : 0,
          )
      })
    }
})

describe("direct model/mode completions stay bound", () => {
  for (const key of ["mode", "model"] as const)
    for (const reject of [false, true]) {
      it(`${key} stale ${reject ? "reject" : "resolve"} cannot set or persist on replacement`, async () => {
        const settings = { lastConfig: {}, setLastConfig: vi.fn() }
        const s = session(settings)
        const c = await attach(s)
        s.config.modes = { currentModeId: "old", availableModes: [{ id: "old", name: "Old" }] }
        s.config.models = {
          currentModelId: "old",
          availableModels: [{ modelId: "old", name: "Old" }],
        }
        const gate = deferred<void>()
        ;(key === "mode" ? c.setSessionMode : c.setSessionModel).mockImplementationOnce(
          () => gate.promise,
        )
        const pending = s.applyConfigOption(key, "stale")
        s.detach()
        await attach(s, client("replacement"))
        s.config.modes = { currentModeId: "replacement", availableModes: [] }
        s.config.models = { currentModelId: "replacement", availableModels: [] }
        const before = snapshot(s)
        if (reject) gate.reject(new Error("stale direct"))
        else gate.resolve()
        await expect(pending).resolves.toBeUndefined()
        expect(snapshot(s)).toEqual(before)
        expect(settings.setLastConfig).not.toHaveBeenCalled()
      })
    }
})

it("newSession without a client retains fallback attach after detach", async () => {
  const s = session()
  await attach(s)
  s.detach()
  h.clients.push(client("fallback") as unknown as AcpClient)
  await s.newSession({ cwd: "/fallback", cliKind: "opencode" })
  expect(s.status).toBe("connected")
  expect(s.sessionId).toBe("fallback")
  expect(s.cwd).toBe("/fallback")
})
