/**
 * Phase 4 — TDD tests for agent-orchestrator with existingSessionId.
 *
 * NOTE: These tests are skipped because the orchestrator was refactored in
 * Slice 10 Phase 1. The ACP session management (createAcpWsLoadTransport,
 * loadSession, etc.) was moved to the FE. The orchestrator no longer creates
 * sessions — it only spawns bridges and marks status="starting".
 *
 * These tests will be DELETED in Slice 10 Phase 4.
 * New tests for dedup behavior are in agent-orchestrator.test.ts.
 */

import type {
  AcpTransport,
  Agent,
  AgentRegistry,
  BridgeHandle,
  BridgeManager,
  CreateAgentInput,
} from "@drive-coding/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ─── Mocks ────────────────────────────────────────────────────────────────────

let mockLoadTransportShouldThrow = false
let mockLoadSessionId = "sess-loaded-1"

function makeOkTransport(sessionId = "sess-new-1"): AcpTransport {
  return {
    async start() {
      return { sessionId, capabilities: { loadSession: true } }
    },
    async prompt() {
      return { stopReason: "end_turn" }
    },
    async cancel() {},
    async shutdown() {},
  }
}

vi.mock("../src/acp/acp-transport.js", () => ({
  createAcpWsTransport: vi.fn(async () => makeOkTransport("sess-new-1")),
  createAcpWsLoadTransport: vi.fn(async () => {
    if (mockLoadTransportShouldThrow) {
      throw new Error("session/load failed")
    }
    return makeOkTransport(mockLoadSessionId)
  }),
}))

// Import AFTER mock
const { createAgentOrchestrator } = await import("../src/app/agent-orchestrator.js")

// ─── Test helpers ─────────────────────────────────────────────────────────────

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

function makeRegistry(preloaded: Agent[] = []): {
  registry: AgentRegistry
  state: Map<string, Agent>
} {
  const state = new Map<string, Agent>(preloaded.map((a) => [a.id, a]))
  const registry: AgentRegistry = {
    async create(input: CreateAgentInput) {
      const agent = makeAgent({
        id: crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
        cliKind: input.cliKind,
        cwd: input.cwd,
        modelOverride: input.modelOverride ?? null,
      })
      state.set(agent.id, agent)
      return agent
    },
    async get(id) {
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

type ExtBridgeMgr = BridgeManager & {
  spawnWithStderr?: (
    id: string,
    input: Parameters<BridgeManager["spawn"]>[1],
  ) => Promise<BridgeHandle & { getStderr: () => string[] }>
}

function makeBridgeManager(): { mgr: ExtBridgeMgr } {
  const mgr: ExtBridgeMgr = {
    async spawn(bridgeId) {
      return makeBridgeHandle({ bridgeId })
    },
    async spawnWithStderr(bridgeId) {
      return Object.assign(makeBridgeHandle({ bridgeId }), { getStderr: () => [] })
    },
    get() {
      return null
    },
    list() {
      return []
    },
    async kill() {
      return true
    },
    onCrash() {
      return () => {}
    },
  }
  return { mgr }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// removed in slice 10 phase 4 — orchestrator no longer manages ACP sessions
describe.skip("AgentOrchestrator — existingSessionId (Phase 4)", () => {
  beforeEach(() => {
    mockLoadTransportShouldThrow = false
    mockLoadSessionId = "sess-loaded-1"
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("happy path without existingSessionId: uses createAcpWsTransport (unchanged behavior)", async () => {
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const agent = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    expect(agent.status).toBe("ready")
    expect(agent.acpSessionId).toBe("sess-new-1")
    expect(state.get(agent.id)?.status).toBe("ready")
  })

  it("happy path with existingSessionId: uses createAcpWsLoadTransport", async () => {
    const { createAcpWsLoadTransport } = await import("../src/acp/acp-transport.js")
    const { registry } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    mockLoadSessionId = "existing-sess-99"

    const agent = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/proj",
      modelOverride: null,
      existingSessionId: "existing-sess-99",
    })

    expect(agent.status).toBe("ready")
    expect(agent.acpSessionId).toBe("existing-sess-99")
    expect(createAcpWsLoadTransport).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "existing-sess-99", cwd: "/proj" }),
    )
  })

  it("dedup hit: same (cwd, acpSessionId) → returns existing ready agent without spawning", async () => {
    const existingAgent = makeAgent({
      id: "00000000-0000-0000-0000-000000000042",
      cwd: "/proj/a",
      status: "ready",
      acpSessionId: "dup-sess",
    })
    const { registry } = makeRegistry([existingAgent])
    const { mgr } = makeBridgeManager()
    const spawnSpy = vi.spyOn(mgr, "spawnWithStderr")
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const agent = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/proj/a",
      modelOverride: null,
      existingSessionId: "dup-sess",
    })

    expect(agent.id).toBe("00000000-0000-0000-0000-000000000042")
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it("dedup miss: different cwd → spawns new agent", async () => {
    const existingAgent = makeAgent({
      id: "00000000-0000-0000-0000-000000000042",
      cwd: "/proj/a",
      status: "ready",
      acpSessionId: "some-sess",
    })
    const { registry } = makeRegistry([existingAgent])
    const { mgr } = makeBridgeManager()
    const spawnSpy = vi.spyOn(mgr, "spawnWithStderr")
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    const agent = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/proj/b", // different cwd → no dedup
      modelOverride: null,
      existingSessionId: "some-sess",
    })

    expect(agent.id).not.toBe("00000000-0000-0000-0000-000000000042")
    expect(spawnSpy).toHaveBeenCalledOnce()
  })

  it("loadSession error → agent status=crashed, throws", async () => {
    mockLoadTransportShouldThrow = true
    const { registry, state } = makeRegistry()
    const { mgr } = makeBridgeManager()
    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    await expect(
      orch.createAndSpawn({
        cliKind: "opencode",
        cwd: "/proj",
        modelOverride: null,
        existingSessionId: "bad-sess",
      }),
    ).rejects.toThrow(/spawn\/attach failed/)

    const agentList = [...state.values()]
    const failed = agentList.find((a) => a.status === "crashed")
    expect(failed).toBeDefined()
  })

  it("dedup: crashed agent is NOT reused (only ready/busy)", async () => {
    const crashedAgent = makeAgent({
      id: "00000000-0000-0000-0000-000000000099",
      cwd: "/proj/c",
      status: "crashed",
      acpSessionId: "crash-sess",
    })
    const { registry } = makeRegistry([crashedAgent])
    const { mgr } = makeBridgeManager()
    const { createAcpWsLoadTransport } = await import("../src/acp/acp-transport.js")
    vi.mocked(createAcpWsLoadTransport).mockClear()

    const orch = createAgentOrchestrator({ registry, bridgeManager: mgr })

    // Should spawn new agent, not reuse the crashed one
    const agent = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/proj/c",
      modelOverride: null,
      existingSessionId: "crash-sess",
    })

    expect(agent.id).not.toBe("00000000-0000-0000-0000-000000000099")
    expect(createAcpWsLoadTransport).toHaveBeenCalledOnce()
  })
})
