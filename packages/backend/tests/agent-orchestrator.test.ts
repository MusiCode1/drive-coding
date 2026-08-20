/**
 * agent-orchestrator.test.ts — CUT-3b-ii rewire.
 *
 * Tests the orchestrator after CUT-3b-ii: uses connectionRegistry instead of bridgeManager.
 * Key behavioral changes:
 *   - bridgePort=0, wsUrl="" (in-process, no WS bridge)
 *   - getBridgePort always returns 0 (not port from handle)
 *   - connectionRegistry.connect replaces bridgeManager.spawn
 *   - crash handler via connectionRegistry.onCrash (not bridgeManager.onCrash)
 *   - modelOverride flows through ConnectOpts (not SpawnBridgeInput directly)
 */

import type { Agent, AgentRegistry, BridgeCrashInfo, CreateAgentInput } from "@drive-coding/core"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ConnectionRegistry } from "../src/acp/connection-registry.js"

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

/** Make a minimal mock ProviderConnection */
function makeConn(pid = 12345): ProviderConnection {
  return {
    wire: { onLine: vi.fn(() => () => {}), write: vi.fn(() => true) },
    capabilities: {
      supportsModelFlag: false,
      supportsSessionResume: false,
      supportsConfigOptions: false,
    },
    onFrame: vi.fn(() => () => {}),
    turn: {
      isBusy: vi.fn(() => false),
      lastActivityAt: vi.fn(() => null),
      onChange: vi.fn(() => () => {}),
    },
    onCrash: vi.fn(() => () => {}),
    close: vi.fn(async () => {}),
    ext: undefined,
    get pid() {
      return pid
    },
  } as ProviderConnection
}

function makeConnectionRegistry(
  opts: {
    onConnectError?: () => Error
    onCrashCapture?: (handler: (id: string, info: BridgeCrashInfo) => void) => void
  } = {},
): {
  reg: ConnectionRegistry
  closeMock: ReturnType<typeof vi.fn>
  connectMock: ReturnType<typeof vi.fn>
  lastConnectOpts: { cwd?: string; modelOverride?: string | null } | null
} {
  let crashHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
  let lastConnectOpts: { cwd?: string; modelOverride?: string | null } | null = null
  const closeMock = vi.fn(async (_id: string) => {})
  const connectMock = vi.fn(
    async (
      _agentId: string,
      _cliKind: string,
      connectOpts: { cwd: string; modelOverride?: string | null },
    ) => {
      lastConnectOpts = connectOpts
      if (opts.onConnectError) throw opts.onConnectError()
      return makeConn()
    },
  )

  const reg: ConnectionRegistry = {
    connect: connectMock,
    get: vi.fn(() => undefined),
    markAttached: vi.fn(),
    markDetached: vi.fn(),
    isAttached: vi.fn(() => false),
    getRuntimeInfo: vi.fn(() => null),
    close: closeMock,
    onCrash(handler) {
      crashHandler = handler
      opts.onCrashCapture?.(handler)
      return () => {
        crashHandler = null
      }
    },
  }

  // expose crash trigger for tests
  void crashHandler

  return {
    reg,
    closeMock,
    connectMock,
    get lastConnectOpts() {
      return lastConnectOpts
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("AgentOrchestrator (CUT-3b-ii)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("createAndSpawn success → returns CreateAndSpawnResult with status=spawning + bridgePort=0", async () => {
    const { registry, state } = makeRegistry()
    const { reg } = makeConnectionRegistry()
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    expect(result.status).toBe("spawning")
    // CUT-3b-ii: bridgePort=0, wsUrl="" (in-process pipe — no real WS bridge)
    expect(result.bridgePort).toBe(0)
    expect(result.wsUrl).toBe("")
    expect(result.agentId).toBeTruthy()

    const agent = state.get(result.agentId)
    expect(agent?.bridgePort).toBe(0)
  })

  it("getBridgePort → returns 0 for known agent (in-process, no real bridge)", async () => {
    const { registry } = makeRegistry()
    const { reg } = makeConnectionRegistry()
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    // CUT-3b-ii: getBridgePort always 0 (in-process)
    expect(orch.getBridgePort(result.agentId)).toBe(0)
  })

  it("getBridgePort → 0 for unknown agent (consistent with in-process stub)", async () => {
    const { registry } = makeRegistry()
    const { reg } = makeConnectionRegistry()
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    // CUT-3b-ii: getBridgePort returns 0 always (no bridgePorts Map)
    expect(orch.getBridgePort("not-here")).toBe(0)
  })

  it("createAndSpawn connection spawn failure → agent status=crashed, throws", async () => {
    const { registry, state } = makeRegistry()
    const { reg } = makeConnectionRegistry({
      onConnectError: () => new Error("ENOENT: opencode not found"),
    })
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    await expect(
      orch.createAndSpawn({ cliKind: "opencode", cwd: "/tmp", modelOverride: null }),
    ).rejects.toThrow(/spawn failed/)

    const agents = [...state.values()]
    expect(agents.length).toBeGreaterThan(0)
    const failed = agents[0]
    expect(failed?.status).toBe("crashed")
  })

  it("deleteAndKill → connection closed, agent removed from registry", async () => {
    const { registry, state } = makeRegistry()
    const { reg, closeMock } = makeConnectionRegistry()
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    await orch.deleteAndKill(result.agentId)

    expect(closeMock).toHaveBeenCalledWith(result.agentId)
    expect(state.has(result.agentId)).toBe(false)
  })

  it("deleteAndKill on non-existent id → no throw, close still attempted", async () => {
    const { registry } = makeRegistry()
    const { reg } = makeConnectionRegistry()
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    await expect(orch.deleteAndKill("ghost-id")).resolves.toBeUndefined()
  })

  it("crash listener: when connection crashes, agent.status → crashed", async () => {
    let capturedHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
    const { registry, state } = makeRegistry()
    const { reg } = makeConnectionRegistry({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    expect(capturedHandler).not.toBeNull()
    capturedHandler?.(result.agentId, { exitCode: 1, signal: null })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(state.get(result.agentId)?.status).toBe("crashed")
  })

  it("crash listener: closed agents are not re-marked crashed", async () => {
    let capturedHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
    const { registry, state } = makeRegistry()
    const { reg } = makeConnectionRegistry({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    await registry.update(result.agentId, { status: "closed" })

    capturedHandler?.(result.agentId, { exitCode: 0, signal: null })
    await new Promise((r) => setImmediate(r))

    expect(state.get(result.agentId)?.status).toBe("closed")
  })

  it("crash listener: SIGKILL → agent.crashReason = 'Killed by signal SIGKILL'", async () => {
    let capturedHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
    const { registry, state } = makeRegistry()
    const { reg } = makeConnectionRegistry({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

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
    const { reg } = makeConnectionRegistry({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

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
    const { reg } = makeConnectionRegistry({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

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

  it("crash listener: exit with info.stderr → crashReason contains the stderr line (Commit 1, wiring)", async () => {
    let capturedHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
    const { registry, state } = makeRegistry()
    const { reg } = makeConnectionRegistry({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    const result = await orch.createAndSpawn({
      cliKind: "cursor",
      cwd: "/tmp",
      modelOverride: null,
    })

    capturedHandler?.(result.agentId, {
      exitCode: 1,
      signal: null,
      stderr: ["Error: No such device or address (os error 6)"],
    })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    const agent = state.get(result.agentId)
    expect(agent?.status).toBe("crashed")
    expect(agent?.crashReason).toBe(
      "Exited with code 1: Error: No such device or address (os error 6)",
    )
  })

  it("crash listener: exit without info.stderr field → crashReason falls back to 'Exited with code N' (regression, undefined-safe)", async () => {
    let capturedHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
    const { registry, state } = makeRegistry()
    const { reg } = makeConnectionRegistry({
      onCrashCapture: (h) => {
        capturedHandler = h
      },
    })
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    const result = await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    capturedHandler?.(result.agentId, { exitCode: 1, signal: null })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    const agent = state.get(result.agentId)
    expect(agent?.status).toBe("crashed")
    expect(agent?.crashReason).toBe("Exited with code 1")
  })

  it("createAndSpawn passes modelOverride to connectionRegistry.connect via ConnectOpts", async () => {
    const { registry } = makeRegistry()
    const { reg, connectMock } = makeConnectionRegistry()
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    await orch.createAndSpawn({
      cliKind: "claude",
      cwd: "/proj",
      modelOverride: "model-z",
    })

    // CUT-3b-ii: modelOverride flows through ConnectOpts (not SpawnBridgeInput directly)
    expect(connectMock).toHaveBeenCalledWith(
      expect.any(String),
      "claude",
      expect.objectContaining({ modelOverride: "model-z" }),
    )
  })

  // slice project-system-prompt Commit 1 — thread systemPrompt through core+BE.
  it("createAndSpawn passes systemPrompt to connectionRegistry.connect via ConnectOpts", async () => {
    const { registry } = makeRegistry()
    const { reg, connectMock } = makeConnectionRegistry()
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    await orch.createAndSpawn({
      cliKind: "claude",
      cwd: "/proj",
      modelOverride: null,
      systemPrompt: "Always end every reply with QAZ",
    })

    expect(connectMock).toHaveBeenCalledWith(
      expect.any(String),
      "claude",
      expect.objectContaining({ systemPrompt: "Always end every reply with QAZ" }),
    )
  })

  it("createAndSpawn without systemPrompt → connectionRegistry.connect receives systemPrompt: null", async () => {
    const { registry } = makeRegistry()
    const { reg, connectMock } = makeConnectionRegistry()
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    await orch.createAndSpawn({
      cliKind: "claude",
      cwd: "/proj",
      modelOverride: null,
    })

    expect(connectMock).toHaveBeenCalledWith(
      expect.any(String),
      "claude",
      expect.objectContaining({ systemPrompt: null }),
    )
  })

  // ─── slice remote-warm-reconnect C2b: ניקוי session-hosts ב-delete/crash ───

  describe("sessionHostRegistry cleanup (slice remote-warm-reconnect C2b)", () => {
    it("deleteAndKill unregisters the session host immediately", async () => {
      const { registry } = makeRegistry()
      const { reg } = makeConnectionRegistry()
      const unregisterHost = vi.fn()
      const orch = createAgentOrchestrator({
        registry,
        connectionRegistry: reg,
        sessionHostRegistry: { unregisterHost },
      })

      const result = await orch.createAndSpawn({
        cliKind: "opencode",
        cwd: "/tmp",
        modelOverride: null,
      })

      await orch.deleteAndKill(result.agentId)

      expect(unregisterHost).toHaveBeenCalledTimes(1)
      expect(unregisterHost).toHaveBeenCalledWith(result.agentId)
    })

    it("crash handler unregisters the session host", async () => {
      let capturedHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
      const { registry } = makeRegistry()
      const { reg } = makeConnectionRegistry({
        onCrashCapture: (h) => {
          capturedHandler = h
        },
      })
      const unregisterHost = vi.fn()
      const orch = createAgentOrchestrator({
        registry,
        connectionRegistry: reg,
        sessionHostRegistry: { unregisterHost },
      })

      const result = await orch.createAndSpawn({
        cliKind: "opencode",
        cwd: "/tmp",
        modelOverride: null,
      })

      capturedHandler?.(result.agentId, { exitCode: 1, signal: null })
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))

      expect(unregisterHost).toHaveBeenCalledWith(result.agentId)
    })

    it("deleteAndKill without sessionHostRegistry (optional dep) — unchanged, no throw", async () => {
      const { registry } = makeRegistry()
      const { reg, closeMock } = makeConnectionRegistry()
      const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

      const result = await orch.createAndSpawn({
        cliKind: "opencode",
        cwd: "/tmp",
        modelOverride: null,
      })

      await expect(orch.deleteAndKill(result.agentId)).resolves.toBeUndefined()
      expect(closeMock).toHaveBeenCalledWith(result.agentId)
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
