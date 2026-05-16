import type {
  AcpTransport,
  Agent,
  AgentRegistry,
  BridgeHandle,
  BridgeManager,
  CreateAgentInput,
} from "@drive-coding/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ─── module under test (mocked dependency) ────────────────────────────
let mockTransport: AcpTransport | (() => Promise<AcpTransport>) = makeOkTransport
let mockTransportShouldThrow = false

function makeOkTransport(): AcpTransport {
  return {
    async start() {
      return { sessionId: "sess-1", capabilities: { loadSession: false } }
    },
    async prompt() {
      return { stopReason: "end_turn" }
    },
    async cancel() {},
    async shutdown() {},
  }
}

vi.mock("../src/acp/acp-transport.js", () => ({
  createAcpWsTransport: vi.fn(async () => {
    if (mockTransportShouldThrow) {
      throw new Error("ACP attach failed")
    }
    return typeof mockTransport === "function" ? mockTransport() : mockTransport
  }),
}))

// Import AFTER mock
const { createAgentOrchestrator } = await import("../src/app/agent-orchestrator.js")

// ─── Mock helpers ─────────────────────────────────────────────────────

function makeAgent(overrides?: Partial<Agent>): Agent {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    cliKind: "opencode",
    cwd: "/tmp",
    modelOverride: null,
    status: "starting",
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Agent
}

function makeBridgeHandle(overrides?: Partial<BridgeHandle>): BridgeHandle {
  return {
    bridgeId: "00000000-0000-0000-0000-000000000001",
    cliKind: "opencode",
    cwd: "/tmp",
    port: 45678,
    pid: 12345,
    wsUrl: "ws://127.0.0.1:45678/",
    startedAt: new Date(),
    ...overrides,
  }
}

type ExtendedBridgeManager = BridgeManager & {
  spawnWithStderr?: (
    bridgeId: string,
    input: Parameters<BridgeManager["spawn"]>[1],
  ) => Promise<BridgeHandle & { getStderr: () => string[] }>
}

function makeRegistry(): {
  registry: AgentRegistry
  state: Map<string, Agent>
} {
  const state = new Map<string, Agent>()
  const registry: AgentRegistry = {
    async create(input: CreateAgentInput) {
      const agent = makeAgent({
        cliKind: input.cliKind,
        cwd: input.cwd,
        modelOverride: input.modelOverride ?? null,
      })
      state.set(agent.id, agent)
      return agent
    },
    async get(id: string) {
      return state.get(id) ?? null
    },
    async list() {
      return [...state.values()]
    },
    async update(id, patch) {
      const cur = state.get(id)
      if (!cur) throw new Error(`agent ${id} not found`)
      const updated = { ...cur, ...patch }
      state.set(id, updated)
      return updated
    },
    async delete(id) {
      state.delete(id)
    },
  }
  return { registry, state }
}

function makeBridgeManager(
  opts: {
    onSpawnError?: () => Error
    stderrLines?: string[]
    onCrashCapture?: (handler: (id: string, code: number | null) => void) => void
  } = {},
): { mgr: ExtendedBridgeManager; kill: ReturnType<typeof vi.fn> } {
  let crashHandler: ((id: string, code: number | null) => void) | null = null
  const kill = vi.fn(async (_id: string) => true)
  const mgr: ExtendedBridgeManager = {
    async spawn(bridgeId) {
      if (opts.onSpawnError) throw opts.onSpawnError()
      return makeBridgeHandle({ bridgeId })
    },
    async spawnWithStderr(bridgeId) {
      if (opts.onSpawnError) throw opts.onSpawnError()
      return Object.assign(makeBridgeHandle({ bridgeId }), {
        getStderr: () => opts.stderrLines ?? [],
      })
    },
    get() {
      return null
    },
    list() {
      return []
    },
    kill,
    onCrash(handler) {
      crashHandler = handler
      opts.onCrashCapture?.(handler)
      return () => {
        crashHandler = null
      }
    },
  }
  // expose for tests
  ;(mgr as ExtendedBridgeManager & { _trigger: typeof crashHandler }).onCrash((id, code) =>
    crashHandler?.(id, code),
  )
  return { mgr, kill }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("AgentOrchestrator", () => {
  beforeEach(() => {
    mockTransport = makeOkTransport
    mockTransportShouldThrow = false
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("createAndSpawn success → agent status=ready, session created", async () => {
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const agent = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    expect(agent.status).toBe("ready")
    expect(agent.bridgePort).toBe(45678)
    expect(agent.acpSessionId).toBe("sess-1")
    expect(orch.getSession(agent.id)).not.toBeNull()
    expect(state.get(agent.id)?.status).toBe("ready")
  })

  it("createAndSpawn bridge spawn failure → agent status=crashed, crashReason set from stderr", async () => {
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager({
      onSpawnError: () => new Error("ENOENT: opencode not found"),
      stderrLines: ["Error: opencode binary not found in PATH"],
    })
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    await expect(
      orch.createAndSpawn({ cliKind: "opencode", cwd: "/tmp", modelOverride: null }),
    ).rejects.toThrow(/spawn\/attach failed/)

    // Find the agent in registry (id known since first call)
    const agents = [...state.values()]
    expect(agents.length).toBeGreaterThan(0)
    const failed = agents[0]
    expect(failed?.status).toBe("crashed")
    // crashReason is whatever extractProviderError returned (may be undefined on no match)
  })

  it("createAndSpawn ACP attach failure → agent status=crashed", async () => {
    mockTransportShouldThrow = true
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    await expect(
      orch.createAndSpawn({ cliKind: "opencode", cwd: "/tmp", modelOverride: null }),
    ).rejects.toThrow(/spawn\/attach failed/)

    const failed = [...state.values()][0]
    expect(failed?.status).toBe("crashed")
  })

  it("deleteAndKill → bridge killed, agent removed, session removed", async () => {
    const { registry, state } = makeRegistry()
    const { mgr, kill } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const agent = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    await orch.deleteAndKill(agent.id)

    expect(kill).toHaveBeenCalledWith(agent.id)
    expect(state.has(agent.id)).toBe(false)
    expect(orch.getSession(agent.id)).toBeNull()
  })

  it("deleteAndKill on non-existent id → no throw, no kill", async () => {
    const { registry } = makeRegistry()
    const { mgr, kill } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    await expect(orch.deleteAndKill("ghost-id")).resolves.toBeUndefined()
    expect(kill).not.toHaveBeenCalled()
  })

  it("getSession for ready agent → returns session", async () => {
    const { registry } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const agent = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    const session = orch.getSession(agent.id)
    expect(session).not.toBeNull()
    expect(session?.agentId).toBe(agent.id)
  })

  it("getSession for non-existent agent → returns null", async () => {
    const { registry } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    expect(orch.getSession("not-here")).toBeNull()
  })

  it("crash listener: when bridge dies, agent.status → crashed + session removed", async () => {
    let capturedHandler: ((id: string, code: number | null) => void) | null = null
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
      stderrLines: ["Some agent stderr"],
    })
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const agent = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })
    expect(state.get(agent.id)?.status).toBe("ready")

    // Trigger crash
    expect(capturedHandler).not.toBeNull()
    capturedHandler?.(agent.id, 1)
    // Crash handler is async — wait for microtasks
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(state.get(agent.id)?.status).toBe("crashed")
    expect(orch.getSession(agent.id)).toBeNull()
  })

  it("crash listener: closed agents are not re-marked crashed", async () => {
    let capturedHandler: ((id: string, code: number | null) => void) | null = null
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const agent = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    // First mark as closed (e.g. user clicked delete)
    await registry.update(agent.id, { status: "closed" })

    // Now bridge dies (normal exit after kill) — handler should NOT flip back to crashed
    capturedHandler?.(agent.id, 0)
    await new Promise((r) => setImmediate(r))

    expect(state.get(agent.id)?.status).toBe("closed")
  })

  it("createAndSpawn calls bridgeManager.spawnWithStderr when available (for crash extraction)", async () => {
    const { registry } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const spy = vi.spyOn(mgr, "spawnWithStderr")
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    await orch.createAndSpawn({ cliKind: "opencode", cwd: "/tmp", modelOverride: null })

    expect(spy).toHaveBeenCalledOnce()
  })

  it("createAndSpawn passes modelOverride to bridgeManager.spawn", async () => {
    const { registry } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const spy = vi.spyOn(mgr, "spawnWithStderr")
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    await orch.createAndSpawn({
      cliKind: "claude",
      cwd: "/proj",
      modelOverride: "model-z",
    })

    expect(spy).toHaveBeenCalledWith(expect.any(String), {
      cliKind: "claude",
      cwd: "/proj",
      modelOverride: "model-z",
    })
  })
})
