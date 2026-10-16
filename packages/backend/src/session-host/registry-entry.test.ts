import { addSink, type LogEntry } from "@drive-coding/core/log"
import { createInitialSessionState, type Patch } from "@drive-coding/core/session"
import type { PermissionPolicyKind } from "@drive-coding/core/types/permission"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import { afterEach, expect, it, vi } from "vitest"
import type { ConnectionRegistry } from "../acp/connection-registry"
import { createPatchesBroadcaster } from "./patches-broadcaster"
import { type AgentSessionRegistry, createAgentSessionRegistry, type HostResult } from "./registry"
import type { ExtendedSessionHost, SessionHostFromConnOptions } from "./session-host"

type AgentSessionRegistryDeps = Parameters<typeof createAgentSessionRegistry>[0]

const registries: AgentSessionRegistry[] = []
afterEach(() => {
  for (const registry of registries.splice(0)) registry.stop()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function host(sessionId: string | null = "ready") {
  const dispose = vi.fn(async () => {})
  return {
    state: createInitialSessionState({ sessionId }),
    patches: new ReadableStream<Patch>(),
    agentCapabilities: {},
    newSession: vi.fn(async () => ({ sessionId: "new" })),
    loadSession: vi.fn(async () => ({ sessionId: "warm" })),
    dispose,
  } as unknown as ExtendedSessionHost
}
function connections() {
  const conn = {} as ProviderConnection
  return {
    get: vi.fn(() => conn),
    getCwd: vi.fn(() => "/tmp/entry"),
    getCliKind: vi.fn(() => "synthetic"),
    isOwnedByWs: vi.fn(() => false),
    listHttpConnectionIds: vi.fn(() => []),
    getEpoch: vi.fn(() => 0),
    getConnectionCount: vi.fn(() => 0),
    getRuntimeInfo: vi.fn(() => null),
    getCharter: vi.fn(() => undefined),
    clearAllConnections: vi.fn(),
  } as unknown as ConnectionRegistry
}
function setup(extra: Partial<AgentSessionRegistryDeps> = {}) {
  const connectionRegistry = connections()
  const createHost = vi.fn(async () => host())
  const deps: AgentSessionRegistryDeps = { connectionRegistry, _createHostFn: createHost, ...extra }
  const registry = createAgentSessionRegistry(deps)
  registries.push(registry)
  return { registry, deps, connectionRegistry, createHost }
}
function entry(result: HostResult) {
  if (!result.ok) throw new Error(`host failed: ${result.reason}`)
  return result.entry
}
it("Registry generates a unique incarnation per entry and preserves it through zero viewers and reconnect", async () => {
  const { registry } = setup()
  const first = entry(await registry.getOrCreateHost("agent-A"))
  const identity = first.broadcaster.hostIncarnation
  expect(identity).toMatch(/^[0-9a-f-]{36}$/)
  const a = first.broadcaster.subscribe(),
    b = first.broadcaster.subscribe()
  expect(entry(await registry.getOrCreateHost("agent-A")).broadcaster.hostIncarnation).toBe(
    identity,
  )
  first.broadcaster.unsubscribe(a)
  first.broadcaster.unsubscribe(b)
  const c = first.broadcaster.subscribe()
  expect(first.broadcaster.hostIncarnation).toBe(identity)
  first.broadcaster.unsubscribe(c)
  const second = entry(await registry.getOrCreateHost("agent-B"))
  expect(second.broadcaster.hostIncarnation).not.toBe(identity)
  registry.unregisterHost("agent-A")
  const recreated = entry(await registry.getOrCreateHost("agent-A"))
  expect(recreated.broadcaster.hostIncarnation).not.toBe(identity)
})
it("missing cwd cannot start host construction", async () => {
  const h = setup()
  vi.mocked(h.connectionRegistry.getCwd).mockReturnValue(undefined)
  await expect(h.registry.getOrCreateHost("missing-cwd")).rejects.toThrow("no cwd")
  expect(h.createHost).not.toHaveBeenCalled()
})
it("handshake failure preserves registry namespace and flat diagnostic fields", async () => {
  const error = new Error("handshake denied"),
    logs: LogEntry[] = []
  const remove = addSink((line) => logs.push(line))
  const h = setup({
    _createHostFn: vi.fn(async () => {
      throw error
    }),
    getAcpSessionId: () => "warm-sid",
  })
  try {
    await expect(h.registry.getOrCreateHost("agent-A")).rejects.toBe(error)
    const diagnostic = logs.find(
      (line) => line.msg === "session-host creation failed (ACP handshake)",
    )
    expect(diagnostic).toMatchObject({
      ns: "backend.session-host.registry",
      fields: {
        agentId: "agent-A",
        cliKind: "synthetic",
        cwd: "/tmp/entry",
        warmReattach: true,
        reason: "handshake denied",
      },
    })
    expect(diagnostic?.fields).not.toHaveProperty("err")
  } finally {
    remove()
  }
})
it("init failure disposes once and never announces an attached session", async () => {
  const created = host(null),
    attached = vi.fn()
  vi.mocked(created.newSession).mockRejectedValue(new Error("init failed"))
  const h = setup({ _createHostFn: async () => created, onSessionAttached: attached })
  await expect(h.registry.getOrCreateHost("agent-A")).rejects.toThrow("init failed")
  expect(created.dispose).toHaveBeenCalledTimes(1)
  expect(attached).not.toHaveBeenCalled()
})
it("injected-ready reports; throwing attached hook warns and keeps the host undisposed", async () => {
  const created = host(),
    attached = vi.fn(async () => {
      throw new Error("hook failed")
    })
  const h = setup({ _createHostFn: async () => created, onSessionAttached: attached })
  expect(entry(await h.registry.getOrCreateHost("agent-A")).host).toBe(created)
  expect(attached).toHaveBeenCalledWith("agent-A", "ready", "/tmp/entry")
  expect(created.newSession).not.toHaveBeenCalled()
  expect(created.dispose).not.toHaveBeenCalled()
})
it("afterHostCreated failure after map commit disposes once without inventing map rollback", async () => {
  const created = host(),
    error = new Error("after commit")
  let registry!: AgentSessionRegistry
  const committed = vi.fn((_agent: string) => {
    expect(registry.getHost("agent-A")).toBe(created)
    throw error
  })
  registry = setup({ _createHostFn: async () => created, afterHostCreated: committed }).registry
  await expect(registry.getOrCreateHost("agent-A")).rejects.toBe(error)
  expect(committed).toHaveBeenCalledTimes(1)
  expect(created.dispose).toHaveBeenCalledTimes(1)
})
it.each(["before-entry", "during-policy"])(
  "captures dependency references %s, reads live getter state and keeps attached hook dynamic",
  async (when) => {
    const policy = deferred<PermissionPolicyKind | undefined>()
    const order: string[] = [],
      receivers: unknown[] = []
    let sid = "first-live-sid",
      close = true
    const getSid = vi.fn(function (this: unknown) {
      receivers.push(this)
      order.push("sid")
      return sid
    })
    const getPolicy = vi.fn(function (this: unknown) {
      receivers.push(this)
      order.push("policy")
      return policy.promise
    })
    const getClose = vi.fn(function (this: unknown) {
      receivers.push(this)
      order.push("close")
      return close
    })
    const schedule = vi.fn(),
      ended = vi.fn(),
      attachedOld = vi.fn(),
      attachedNew = vi.fn()
    const options: SessionHostFromConnOptions[] = []
    const createHost = vi.fn(
      async (_conn: ProviderConnection, opts?: SessionHostFromConnOptions) => {
        options.push(opts ?? {})
        return host()
      },
    )
    const createBroadcaster = vi.fn((patches: ReadableStream<Patch>, identity?: string) =>
      createPatchesBroadcaster(patches, identity ?? "fixture-identity"),
    )
    const h = setup({
      _createHostFn: createHost,
      _createBroadcasterFn: createBroadcaster,
      getAcpSessionId: getSid,
      getPermissionPolicy: getPolicy,
      getCloseOnTurnEnd: getClose,
      onScheduleCloseOnTurnEnd: schedule,
      onTurnEnded: ended,
      onSessionAttached: attachedOld,
    })
    const unexpected = vi.fn(() => {
      throw new Error("replacement dependency invoked")
    })
    function replace() {
      h.deps.connectionRegistry = connections()
      h.deps._createHostFn = unexpected
      h.deps._createBroadcasterFn = unexpected
      h.deps.getAcpSessionId = unexpected
      h.deps.getPermissionPolicy = unexpected
      h.deps.getCloseOnTurnEnd = unexpected
      h.deps.onScheduleCloseOnTurnEnd = unexpected
      h.deps.onTurnEnded = unexpected
      h.deps.onSessionAttached = attachedNew
    }
    expect(getSid).not.toHaveBeenCalled()
    expect(getPolicy).not.toHaveBeenCalled()
    if (when === "before-entry") replace()
    const first = h.registry.getOrCreateHost("agent-A")
    void first.catch(() => {})
    await vi.waitFor(() => expect(getPolicy).toHaveBeenCalledTimes(1))
    if (when === "during-policy") replace()
    policy.resolve("ask")
    const firstEntry = entry(await first)
    expect(firstEntry.host).toBeDefined()
    expect(createHost).toHaveBeenCalledTimes(1)
    expect(createBroadcaster).toHaveBeenCalledTimes(1)
    expect(firstEntry.broadcaster.hostIncarnation).toBeDefined()
    expect(order).toEqual(["sid", "policy", "close"])
    expect(receivers).toEqual([undefined, undefined, undefined])
    expect(options[0]).toMatchObject({
      warmReattach: { acpSessionId: "first-live-sid" },
      permissionPolicy: "ask",
      closeOnTurnEnd: true,
    })
    options[0]?.onScheduleCloseOnTurnEnd?.()
    options[0]?.onTurnEnded?.({} as never)
    expect(schedule).toHaveBeenCalledWith("agent-A")
    expect(ended).toHaveBeenCalledWith("agent-A", {})
    expect(attachedOld).not.toHaveBeenCalled()
    expect(attachedNew).toHaveBeenCalledWith("agent-A", "ready", "/tmp/entry")
    sid = "second-live-sid"
    close = false
    await h.registry.getOrCreateHost("agent-B")
    expect(options[1]?.warmReattach?.acpSessionId).toBe("second-live-sid")
    expect(options[1]?.closeOnTurnEnd).toBeUndefined()
    await h.registry.notifySessionAttached("agent-C", "notify-sid", "/tmp/new")
    expect(attachedNew).toHaveBeenCalledWith("agent-C", "notify-sid", "/tmp/new")
    expect(unexpected).not.toHaveBeenCalled()
  },
)
it("injected broadcaster receives exactly the factory incarnation stored on the entry", async () => {
  const forwarded: string[] = []
  const h = setup({
    _createBroadcasterFn: (patches, identity) => {
      forwarded.push(identity)
      return createPatchesBroadcaster(patches, identity)
    },
  })
  const a = entry(await h.registry.getOrCreateHost("agent-A"))
  const b = entry(await h.registry.getOrCreateHost("agent-B"))
  expect(forwarded).toEqual([a.broadcaster.hostIncarnation, b.broadcaster.hostIncarnation])
  expect(forwarded[0]).toMatch(/^[0-9a-f-]{36}$/)
  expect(forwarded[1]).not.toBe(forwarded[0])
})
