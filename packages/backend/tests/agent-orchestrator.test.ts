/**
 * agent-orchestrator.test.ts — Slice 10 Phase 1.
 *
 * Tests the slimmed-down orchestrator:
 *   - createAndSpawn → returns CreateAndSpawnResult with status="spawning"
 *   - deleteAndKill → kills bridge + removes from registry
 *   - getBridgePort → returns port
 *   - crash handler → marks agent crashed
 *
 * The old tests for getSession/createAgentSession/ACP transport are removed in
 * Slice 10 Phase 4. Tests that tested ACP attach (session creation) are
 * skipped here with comment "removed in slice 10 phase 4".
 */

import type {
  Agent,
  AgentRegistry,
  BridgeHandle,
  BridgeManager,
  CreateAgentInput,
} from "@drive-coding/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Import after module (no mocks needed since ACP transport is removed from orchestrator)
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

import type { BridgeCrashInfo } from "@drive-coding/core"

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
    onCrashCapture?: (handler: (id: string, info: BridgeCrashInfo) => void) => void
  } = {},
): { mgr: ExtendedBridgeManager; kill: ReturnType<typeof vi.fn> } {
  let crashHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
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
    onCrash(handler: (id: string, info: BridgeCrashInfo) => void) {
      crashHandler = handler
      opts.onCrashCapture?.(handler)
      return () => {
        crashHandler = null
      }
    },
  }
  // expose for tests
  ;(mgr as ExtendedBridgeManager & { _trigger: typeof crashHandler }).onCrash((id, info) =>
    crashHandler?.(id, info),
  )
  return { mgr, kill }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("AgentOrchestrator (Slice 10 — slim)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("createAndSpawn success → returns CreateAndSpawnResult with status=spawning + bridgePort", async () => {
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    // Slice 10: status is "spawning" (FE-facing term), registry uses "starting"
    expect(result.status).toBe("spawning")
    expect(result.bridgePort).toBe(45678)
    expect(result.agentId).toBeTruthy()
    expect(result.wsUrl).toContain("45678")

    // Registry should have agent with port set, status="starting"
    const agent = state.get(result.agentId)
    expect(agent?.bridgePort).toBe(45678)
  })

  it("getBridgePort → returns port for known agent", async () => {
    const { registry } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    expect(orch.getBridgePort(result.agentId)).toBe(45678)
  })

  it("getBridgePort → null for unknown agent", async () => {
    const { registry } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    expect(orch.getBridgePort("not-here")).toBeNull()
  })

  it("createAndSpawn bridge spawn failure → agent status=crashed, throws", async () => {
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager({
      onSpawnError: () => new Error("ENOENT: opencode not found"),
    })
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    await expect(
      orch.createAndSpawn({ cliKind: "opencode", cwd: "/tmp", modelOverride: null }),
    ).rejects.toThrow(/spawn failed/)

    const agents = [...state.values()]
    expect(agents.length).toBeGreaterThan(0)
    const failed = agents[0]
    expect(failed?.status).toBe("crashed")
  })

  it("deleteAndKill → bridge killed, agent removed from registry", async () => {
    const { registry, state } = makeRegistry()
    const { mgr, kill } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    await orch.deleteAndKill(result.agentId)

    expect(kill).toHaveBeenCalledWith(result.agentId)
    expect(state.has(result.agentId)).toBe(false)
    // getBridgePort also cleaned up
    expect(orch.getBridgePort(result.agentId)).toBeNull()
  })

  it("deleteAndKill on non-existent id → no throw, kill still attempted", async () => {
    const { registry } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    // Should not throw even for unknown id
    await expect(orch.deleteAndKill("ghost-id")).resolves.toBeUndefined()
  })

  it("crash listener: when bridge dies, agent.status → crashed", async () => {
    let capturedHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    // Simulate bridge crash
    expect(capturedHandler).not.toBeNull()
    capturedHandler?.(result.agentId, { exitCode: 1, signal: null })
    // Crash handler is async — wait for microtasks
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(state.get(result.agentId)?.status).toBe("crashed")
    // getBridgePort also cleaned up after crash
    expect(orch.getBridgePort(result.agentId)).toBeNull()
  })

  it("crash listener: closed agents are not re-marked crashed", async () => {
    let capturedHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    // Mark as closed (e.g. user deleted)
    await registry.update(result.agentId, { status: "closed" })

    // Bridge dies (normal exit after kill) — should NOT flip back to crashed
    capturedHandler?.(result.agentId, { exitCode: 0, signal: null })
    await new Promise((r) => setImmediate(r))

    expect(state.get(result.agentId)?.status).toBe("closed")
  })

  it("crash listener: SIGKILL → agent.crashReason = 'Killed by signal SIGKILL'", async () => {
    let capturedHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    capturedHandler?.(result.agentId, { exitCode: null, signal: "SIGKILL" })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    const agent = state.get(result.agentId)
    expect(agent?.status).toBe("crashed")
    expect(agent?.crashReason).toBe("Killed by signal SIGKILL")
  })

  it("crash listener: ENOENT spawn error → agent.crashReason contains ENOENT", async () => {
    let capturedHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    capturedHandler?.(result.agentId, {
      exitCode: null,
      signal: null,
      spawnError: { code: "ENOENT", message: "spawn opencode ENOENT" },
    })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    const agent = state.get(result.agentId)
    expect(agent?.status).toBe("crashed")
    expect(agent?.crashReason).toBe("ENOENT: spawn opencode ENOENT")
  })

  it("crash listener: clean exit (code 0) → no crashReason", async () => {
    let capturedHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    // Override status guard so we can observe crashReason even on code=0
    const agent0 = makeAgent({ status: "ready" })
    state.set(agent0.id, agent0)

    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })
    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    capturedHandler?.(result.agentId, { exitCode: 0, signal: null })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    const agent = state.get(result.agentId)
    expect(agent?.status).toBe("crashed")
    expect(agent?.crashReason).toBeUndefined()
  })

  it("createAndSpawn passes modelOverride to bridgeManager.spawnWithStderr", async () => {
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

  // removed in slice 10 phase 4 — old tests for getSession, ACP session creation
  describe.skip("OLD: session management (removed in Slice 10 Phase 4)", () => {
    it("createAndSpawn success → session created", () => {})
    it("getSession for ready agent → returns session", () => {})
    it("getSession for non-existent agent → returns null", () => {})
    it("createAndSpawn ACP attach failure → agent status=crashed", () => {})
    it("deleteAndKill → session removed", () => {})
  })
})
