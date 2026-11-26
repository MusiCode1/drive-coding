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

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Agent, AgentRegistry, BridgeCrashInfo, CreateAgentInput } from "@drive-coding/core"
import { addSink, type LogEntry } from "@drive-coding/core/log"
import type { TurnStateValue } from "@drive-coding/core/session"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import ts from "typescript"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ConnectionRegistry } from "../src/acp/connection-registry.js"
import * as launcher from "../src/agents/agent-launcher.js"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"

const { createAgentOrchestrator, composeShapeEnv } = await import(
  "../src/app/agent-orchestrator.js"
)
const {
  DC_TOKEN_ENV,
  hasAllowAlwaysGrant,
  issueToken,
  recordAllowAlwaysGrant,
  resetAllowAlwaysGrantsForTests,
} = await import("../src/agent-scope.js")

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
  closeMock: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>
  connectMock: ReturnType<typeof vi.fn>
  lastConnectOpts: {
    cwd?: string
    modelOverride?: string | null
    shapeEnv?: (cliKind: string, base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
    agentEnv?: Record<string, string>
  } | null
} {
  let crashHandler: ((id: string, info: BridgeCrashInfo) => void) | null = null
  let lastConnectOpts: {
    cwd?: string
    modelOverride?: string | null
    shapeEnv?: (cliKind: string, base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
    agentEnv?: Record<string, string>
  } | null = null
  const closeMock = vi.fn(async (_id: string) => {})
  const connectMock = vi.fn(
    async (
      _agentId: string,
      _cliKind: string,
      connectOpts: {
        cwd: string
        modelOverride?: string | null
        shapeEnv?: (cliKind: string, base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
        agentEnv?: Record<string, string>
      },
    ) => {
      lastConnectOpts = connectOpts
      if (opts.onConnectError) throw opts.onConnectError()
      return makeConn()
    },
  )

  const reg: ConnectionRegistry = {
    connect: connectMock,
    get: vi.fn(() => undefined),
    getCwd: vi.fn(() => undefined),
    getCharter: vi.fn(() => undefined),
    consumeCharter: vi.fn(() => undefined),
    getCliKind: vi.fn(() => undefined),
    list: vi.fn(() => []),
    addConnection: vi.fn(),
    removeConnection: vi.fn(),
    touchConnection: vi.fn(),
    clearAllConnections: vi.fn(),
    getConnectionCount: vi.fn(() => 0),
    isAttached: vi.fn(() => false),
    getEpoch: vi.fn(() => 0),
    getRuntimeInfo: vi.fn(() => null),
    getLastSeenAt: vi.fn(() => null),
    listHttpConnectionIds: vi.fn(() => []),
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

  it("deleteAndKill clears allow_always grants involving the agent", async () => {
    resetAllowAlwaysGrantsForTests()
    const { registry } = makeRegistry()
    const { reg } = makeConnectionRegistry()
    const orch = createAgentOrchestrator({ registry, connectionRegistry: reg })

    const a = await orch.createAndSpawn({ cliKind: "opencode", cwd: "/tmp/a", modelOverride: null })
    const b = await orch.createAndSpawn({ cliKind: "opencode", cwd: "/tmp/b", modelOverride: null })
    recordAllowAlwaysGrant(a.agentId, b.agentId, "close")

    await orch.deleteAndKill(a.agentId)
    expect(hasAllowAlwaysGrant(a.agentId, b.agentId, "close")).toBe(false)
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

  // slice session-create-contract C2 — env via composeShapeEnv (wraps drivecodingShapeEnv).
  describe("composeShapeEnv (C2)", () => {
    it("merges env above baseEnv without dropping existing keys", () => {
      const shape = composeShapeEnv({ BDS_SLICE: "probe" })
      const result = shape("cursor", { PATH: "/bin", HOME: "/home/user" })
      expect(result).toMatchObject({
        PATH: "/bin",
        HOME: "/home/user",
        BDS_SLICE: "probe",
      })
    })

    it("opencode: OPENCODE_CONFIG_CONTENT still injected (regression)", () => {
      const shape = composeShapeEnv({ BDS_SLICE: "probe" })
      const result = shape("opencode", {})
      expect(result.OPENCODE_CONFIG_CONTENT).toBeTruthy()
      expect(result.PROMPT_INJECTOR_TEXT).toBeTruthy()
      expect(result.BDS_SLICE).toBe("probe")
    })

    it("absent env → identical to drivecodingShapeEnv behavior for opencode", () => {
      const composed = composeShapeEnv(undefined)
      const direct = composeShapeEnv(undefined)
      const base = { FOO: "bar" }
      expect(composed("opencode", base)).toEqual(direct("opencode", base))
    })
  })

  it("createAndSpawn passes env through shapeEnv to connect", async () => {
    const { registry } = makeRegistry()
    const connReg = makeConnectionRegistry()
    const orch = createAgentOrchestrator({ registry, connectionRegistry: connReg.reg })

    const result = await orch.createAndSpawn({
      cliKind: "cursor",
      cwd: "/proj",
      modelOverride: null,
      env: { BDS_SLICE: "probe" },
    })

    expect(connReg.lastConnectOpts?.shapeEnv).toBeTypeOf("function")
    const shaped = connReg.lastConnectOpts!.shapeEnv!("cursor", { EXISTING: "yes" })
    expect(shaped).toMatchObject({ EXISTING: "yes", BDS_SLICE: "probe" })
    expect(shaped.DRIVE_CODING_BASE).toMatch(/^http:\/\//)
    expect(shaped.DC_BASE).toBe(shaped.DRIVE_CODING_BASE)
    expect(shaped.DRIVE_CODING_AGENT_ID).toBeTruthy()
    // agentEnv carries the same BASE/identity for in-process bridges
    expect(connReg.lastConnectOpts).toMatchObject({
      agentEnv: expect.objectContaining({
        DRIVE_CODING_BASE: shaped.DRIVE_CODING_BASE,
        DC_BASE: shaped.DC_BASE,
        BDS_SLICE: "probe",
      }),
    })

    const expectedToken = issueToken(result.agentId)
    expect(shaped[DC_TOKEN_ENV]).toBe(expectedToken)
    expect(connReg.lastConnectOpts?.agentEnv?.[DC_TOKEN_ENV]).toBe(expectedToken)
  })

  it.each([
    { name: "parent field only", hasParent: true, env: undefined },
    { name: "parent field and independent env", hasParent: true, env: { DC_PARENT: "legacy" } },
    { name: "legacy env only", hasParent: false, env: { DC_PARENT: "legacy" } },
  ])(
    "keeps the parent record and child environment separate for $name",
    async ({ hasParent, env }) => {
      const registry = createInMemoryAgentRegistry()
      const parent = await registry.create({ cliKind: "cursor", cwd: "/tmp/parent" })
      const connReg = makeConnectionRegistry()
      const orch = createAgentOrchestrator({ registry, connectionRegistry: connReg.reg })

      const { agentId } = await orch.createAndSpawn({
        cliKind: "cursor",
        cwd: "/tmp/child",
        ...(hasParent ? { parentAgentId: parent.id } : {}),
        ...(env === undefined ? {} : { env }),
      })

      const child = await registry.get(agentId)
      expect(child).not.toBeNull()
      expect(child?.parentAgentId).toBe(hasParent ? parent.id : undefined)
      const opts = connReg.lastConnectOpts
      expect(opts?.shapeEnv).toBeTypeOf("function")
      expect(opts?.agentEnv).toBeDefined()
      expect(opts?.shapeEnv?.("cursor", {}).DC_PARENT).toBe(env?.DC_PARENT)
      expect(opts?.agentEnv?.DC_PARENT).toBe(env?.DC_PARENT)
    },
  )

  it("createAndSpawn forces loopback BASE even if caller passes a public URL", async () => {
    const { registry } = makeRegistry()
    const connReg = makeConnectionRegistry()
    const orch = createAgentOrchestrator({
      registry,
      connectionRegistry: connReg.reg,
      urlConfig: { port: 4371, host: "127.0.0.1", publicBaseUrl: "https://public.example.com" },
    })

    await orch.createAndSpawn({
      cliKind: "cursor",
      cwd: "/proj",
      modelOverride: null,
      env: {
        DRIVE_CODING_BASE: "https://public.example.com",
        DC_BASE: "https://public.example.com",
      },
    })

    const shaped = connReg.lastConnectOpts!.shapeEnv!("cursor", {})
    expect(shaped.DRIVE_CODING_BASE).toBe("http://127.0.0.1:4371")
    expect(shaped.DC_BASE).toBe("http://127.0.0.1:4371")
  })

  it("createAndSpawn without env → shapeEnv still wraps opencode injection", async () => {
    const { registry } = makeRegistry()
    const connReg = makeConnectionRegistry()
    const orch = createAgentOrchestrator({ registry, connectionRegistry: connReg.reg })

    await orch.createAndSpawn({
      cliKind: "opencode",
      cwd: "/proj",
      modelOverride: null,
    })

    const shaped = connReg.lastConnectOpts!.shapeEnv!("opencode", {})
    expect(shaped.OPENCODE_CONFIG_CONTENT).toBeTruthy()
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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

let nextTreeFixture = 0

function makeCloseHarness() {
  const prefix = `a7-${++nextTreeFixture}-`
  const { registry, state } = makeRegistry()
  const readList = registry.list
  const list = vi.spyOn(registry, "list")
  const readAgent = registry.get
  const deleteAgent = registry.delete
  const get = vi.spyOn(registry, "get")
  const update = vi.spyOn(registry, "update")
  const remove = vi.spyOn(registry, "delete")
  const crash = { handler: undefined as ((id: string, info: BridgeCrashInfo) => void) | undefined }
  const { reg, closeMock: close } = makeConnectionRegistry({
    onCrashCapture: (handler) => {
      crash.handler = handler
    },
  })
  const hosts = new Map<string, TurnStateValue>()
  const unregister = vi.fn((id: string) => {
    hosts.delete(id)
  })
  const readHost = (id: string) => {
    const turnState = hosts.get(id)
    return turnState === undefined ? undefined : { state: { turnState } }
  }
  const getHost = vi.fn(readHost)
  const orch = createAgentOrchestrator({
    registry,
    connectionRegistry: reg,
    sessionHostRegistry: { unregisterHost: unregister, getHost },
  })

  function seed(name: string, parent?: string, turnState?: TurnStateValue) {
    const id = prefix + name
    state.set(id, makeAgent({ id, status: "ready", parentAgentId: parent }))
    if (turnState !== undefined) hosts.set(id, turnState)
    return id
  }

  function expectEffects(
    stop: typeof launcher.stopAgentUnit,
    expected: {
      started: string[]
      connected?: string[]
      finished?: string[]
      updates?: Array<Parameters<AgentRegistry["update"]>>
    },
  ) {
    const connected = expected.connected ?? expected.started
    const finished = expected.finished ?? connected
    expect(unregister.mock.calls).toEqual(expected.started.map((id) => [id]))
    expect(update.mock.calls).toEqual(
      expected.updates ?? expected.started.map((id) => [id, { status: "closed" }]),
    )
    expect(close.mock.calls).toEqual(connected.map((id) => [id]))
    expect(vi.mocked(stop).mock.calls).toEqual(finished.map((id) => [id]))
    expect(remove.mock.calls).toEqual(finished.map((id) => [id]))
  }

  return {
    orch,
    state,
    list,
    get,
    update,
    remove,
    close,
    unregister,
    getHost,
    readHost,
    readList,
    readAgent,
    deleteAgent,
    hosts,
    crash,
    seed,
    expectEffects,
  }
}

function expectClosed(closed: string[], closedWhileBusy: string[] = []) {
  return { closed, failed: [], closedWhileBusy }
}

describe("internal agent tree closure", () => {
  let stop: typeof launcher.stopAgentUnit

  beforeEach(() => {
    stop = vi.spyOn(launcher, "stopAgentUnit").mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetAllowAlwaysGrantsForTests()
  })

  it("closes a leaf once and reports a missing root or list failure before effects", async () => {
    const h = makeCloseHarness()
    const leaf = h.seed("leaf")
    const missing = "a7-missing-root"
    const result = await h.orch.closeTree(leaf)
    h.expectEffects(stop, { started: [leaf] })
    expect(result).toEqual(expectClosed([leaf]))
    expect(h.state.has(leaf)).toBe(false)
    expect(h.list).toHaveBeenCalledTimes(1)

    expect(await h.orch.closeTree(missing)).toEqual({
      ...expectClosed([]),
      failed: [{ agentId: missing, error: "not found" }],
    })
    h.list.mockRejectedValueOnce("list unavailable")
    expect(await h.orch.closeTree(missing)).toEqual({
      ...expectClosed([]),
      failed: [{ agentId: missing, error: "list unavailable" }],
    })
    expect(h.list).toHaveBeenCalledTimes(3)
    expect(h.get.mock.calls).toEqual([[leaf]])
    h.expectEffects(stop, { started: [leaf] })
  })

  it("processes a split tree in sibling order, waiting for each leaf with a fixed snapshot", async () => {
    const h = makeCloseHarness()
    const root = h.seed("root")
    const a = h.seed("a", root)
    const b = h.seed("b", root)
    const a1 = h.seed("a1", a)
    const b1 = h.seed("b1", b)
    const b2 = h.seed("b2", b)
    const foreign = h.seed("foreign")
    const foreignChild = h.seed("foreign-child", foreign)
    const entered = deferred()
    const release = deferred()
    h.close.mockImplementationOnce(() => {
      entered.resolve()
      return release.promise
    })

    const result = h.orch.closeTree(root)
    // At least one close must start before the test arms the remaining assertions.
    await Promise.race([entered.promise, result])
    h.expectEffects(stop, { started: [a1], finished: [] })
    expect(h.get.mock.calls).toEqual([[a1]])
    const newcomer = h.seed("newcomer", b)
    release.resolve()

    const order = [a1, a, b1, b2, b, root]
    expect(await result).toEqual(expectClosed(order))
    h.expectEffects(stop, { started: order })
    expect(h.list).toHaveBeenCalledTimes(1)
    expect([...h.state.keys()]).toEqual([foreign, foreignChild, newcomer])
  })

  it("closes a 26-node chain in full-depth post-order", async () => {
    const h = makeCloseHarness()
    const root = h.seed("root")
    const chain = [root]
    for (let depth = 1; depth < 26; depth++) {
      chain.push(h.seed(`child-${depth}`, chain.at(-1)))
    }
    const expected = chain.reverse()
    const result = await h.orch.closeTree(root)
    h.expectEffects(stop, { started: expected })
    expect(result).toEqual(expectClosed(expected))
    expect(h.state.size).toBe(0)
  })

  it.each(["A", "B"])("uses the normalized cycle when starting at %s", async (selection) => {
    const h = makeCloseHarness()
    const a = h.seed("a", undefined, "idle")
    const b = h.seed("b", a, "idle")
    const original = h.state.get(a)
    h.state.set(a, makeAgent({ ...original, id: a, parentAgentId: b }))
    const c = h.seed("c", b, "idle")
    const foreign = h.seed("stranger", undefined, "idle")
    const expected = selection === "A" ? [c, b, a] : [c, b]
    const surviving = selection === "A" ? [foreign] : [a, foreign]

    expect(await h.orch.closeTree(selection === "A" ? a : b)).toEqual(expectClosed(expected))
    h.expectEffects(stop, { started: expected })
    expect([...h.state.keys()]).toEqual(surviving)
    expect([...h.hosts.keys()]).toEqual(surviving)
  })

  it("closes an orphan's branch without touching other roots", async () => {
    const h = makeCloseHarness()
    const orphan = h.seed("orphan", "a7-absent-parent")
    const child = h.seed("child", orphan)
    const grandchild = h.seed("grandchild", child)
    const outsider = h.seed("unrelated")
    const expected = [grandchild, child, orphan]
    expect(await h.orch.closeTree(orphan)).toEqual(expectClosed(expected))
    h.expectEffects(stop, { started: expected })
    expect([...h.state.keys()]).toEqual([outsider])
  })

  it("reports actual busy descendants and continues through close, get and delete failures", async () => {
    const h = makeCloseHarness()
    const root = h.seed("root", undefined, "thinking")
    const waiting = h.seed("waiting", root, "waiting")
    const closeFailure = h.seed("close-failure", root, "responding")
    const idle = h.seed("idle", root, "idle")
    const getFailure = h.seed("get-failure", root)
    const noHost = h.seed("no-host", root)
    h.get.mockImplementation(async (id) => {
      if (id === getFailure) throw new Error("lookup failed")
      return h.readAgent(id)
    })
    h.close.mockImplementation(async (id) => {
      if (id === closeFailure) throw new Error("connection refused to close")
    })
    h.remove.mockImplementation(async (id) => {
      if (id === idle) throw new Error("delete unavailable")
      await h.deleteAgent(id)
    })
    const entries: LogEntry[] = []
    const off = addSink((entry) => entries.push(entry))
    const closed = [waiting, idle, noHost, root]
    const failed = [
      { agentId: closeFailure, error: "connection refused to close" },
      { agentId: getFailure, error: "lookup failed" },
    ]

    try {
      expect(await h.orch.closeTree(root)).toEqual({ closed, failed, closedWhileBusy: [waiting] })
    } finally {
      off()
    }
    h.expectEffects(stop, {
      started: [waiting, closeFailure, idle, noHost, root],
      finished: closed,
    })
    expect([...h.state.keys()]).toEqual([closeFailure, idle, getFailure])
    const treeLogs = entries.filter((entry) => entry.ns === "backend.orchestrator")
    expect(treeLogs.filter((entry) => entry.fields?.wasTurnState !== undefined)).toEqual([
      expect.objectContaining({
        level: "warn",
        fields: { agentId: waiting, wasTurnState: "waiting" },
      }),
    ])
    expect(
      treeLogs.filter((entry) => entry.level === "info" && entry.fields?.rootId === root),
    ).toEqual([
      expect.objectContaining({
        fields: { rootId: root, closed: 4, failed: 2, closedWhileBusy: 1 },
      }),
    ])
    expect(
      treeLogs.filter((entry) => entry.level === "warn" && entry.fields?.rootId === root),
    ).toEqual([expect.objectContaining({ fields: { rootId: root, failed } })])
  })

  it("counts a child closed by a separate call before the tree reaches it", async () => {
    const h = makeCloseHarness()
    const root = h.seed("root")
    const first = h.seed("first", root)
    const removed = h.seed("removed", root, "waiting")
    const entered = deferred()
    const release = deferred()
    h.close.mockImplementationOnce(() => {
      entered.resolve()
      return release.promise
    })
    const tree = h.orch.closeTree(root)
    await Promise.race([entered.promise, tree])
    await h.orch.deleteAndKill(removed)
    release.resolve()
    expect(await tree).toEqual(expectClosed([first, removed, root]))
    expect(h.get.mock.calls).toEqual([[first], [removed], [root]])
    h.expectEffects(stop, {
      started: [first, removed, root],
      finished: [removed, first, root],
    })
  })

  it("starts two direct calls synchronously and returns independent results", async () => {
    const h = makeCloseHarness()
    const id = h.seed("target", undefined, "idle")
    const firstClose = deferred()
    const secondClose = deferred()
    h.close.mockReturnValueOnce(firstClose.promise).mockReturnValueOnce(secondClose.promise)
    const first = h.orch.deleteAndKill(id)
    const second = h.orch.deleteAndKill(id)
    const firstFailure = expect(first).rejects.toThrow("first close failed")

    expect(first).not.toBe(second)
    expect(h.hosts.has(id)).toBe(false)
    h.expectEffects(stop, { started: [id, id], connected: [], finished: [] })
    expect(h.get).not.toHaveBeenCalled()
    expect(h.getHost).not.toHaveBeenCalled()
    expect(h.list).not.toHaveBeenCalled()

    firstClose.reject(new Error("first close failed"))
    secondClose.resolve()
    await firstFailure
    await expect(second).resolves.toBeUndefined()
    h.expectEffects(stop, { started: [id, id], finished: [id] })
  })

  it("returns a rejected Promise when direct host removal throws synchronously", async () => {
    const h = makeCloseHarness()
    const id = h.seed("target")
    const error = new Error("host removal failed")
    h.unregister.mockImplementationOnce(() => {
      throw error
    })
    const call = h.orch.deleteAndKill(id)
    await expect(call).rejects.toBe(error)
    h.expectEffects(stop, { started: [id], connected: [], finished: [], updates: [] })
    await expect(h.orch.deleteAndKill(id)).resolves.toBeUndefined()
  })

  it("shares a tree's physical Promise with synchronous reentry and overlapping callers", async () => {
    const h = makeCloseHarness()
    const parent = h.seed("parent")
    const child = h.seed("child", parent, "waiting")
    const outsider = h.seed("outsider")
    const entered = deferred()
    const joinedTarget = deferred()
    const release = deferred()
    let duringUnregister: Promise<void> | undefined
    h.unregister.mockImplementationOnce((id) => {
      h.hosts.delete(id)
      duringUnregister = h.orch.deleteAndKill(id)
    })
    h.close.mockImplementationOnce(() => {
      entered.resolve()
      return release.promise
    })
    const entries: LogEntry[] = []
    const off = addSink((entry) => entries.push(entry))

    try {
      const asRoot = h.orch.closeTree(child)
      await Promise.race([entered.promise, asRoot])
      h.list.mockImplementationOnce(async () => {
        joinedTarget.resolve()
        return h.readList()
      })
      const asChild = h.orch.closeTree(parent)
      await joinedTarget.promise
      const direct = h.orch.deleteAndKill(child)
      expect(duringUnregister).toBe(direct)
      expect(h.orch.deleteAndKill(child)).toBe(direct)
      await h.orch.deleteAndKill(outsider)
      h.expectEffects(stop, {
        started: [child, outsider],
        finished: [outsider],
      })

      release.resolve()
      await expect(direct).resolves.toBeUndefined()
      expect(await asRoot).toEqual(expectClosed([child]))
      expect(await asChild).toEqual(expectClosed([child, parent], [child]))
      expect(h.get.mock.calls).toEqual([[child], [parent]])
    } finally {
      off()
    }
    h.expectEffects(stop, {
      started: [child, outsider, parent],
      finished: [outsider, child, parent],
    })
    expect(entries.filter((entry) => entry.fields?.wasTurnState !== undefined)).toEqual([
      expect.objectContaining({
        level: "warn",
        fields: { agentId: child, wasTurnState: "waiting" },
      }),
    ])
  })

  it("shares physical rejection between two trees and direct callers, then retries", async () => {
    const h = makeCloseHarness()
    const id = h.seed("target", undefined, "waiting")
    const entered = deferred()
    const release = deferred()
    const error = new Error("physical close failed")
    h.close.mockImplementationOnce(() => {
      entered.resolve()
      return release.promise
    })
    const firstTree = h.orch.closeTree(id)
    await Promise.race([entered.promise, firstTree])
    const secondTree = h.orch.closeTree(id)
    const direct = h.orch.deleteAndKill(id)
    const directFailure = expect(direct).rejects.toBe(error)
    expect(h.orch.deleteAndKill(id)).toBe(direct)
    // The second tree resumes its resolved snapshot before the physical rejection settles.
    release.reject(error)
    await directFailure
    const failed = { ...expectClosed([]), failed: [{ agentId: id, error: error.message }] }
    expect(await firstTree).toEqual(failed)
    expect(await secondTree).toEqual(failed)
    expect(h.get.mock.calls).toEqual([[id]])
    h.expectEffects(stop, { started: [id], finished: [] })
    expect(await h.orch.closeTree(id)).toEqual(expectClosed([id]))
    h.expectEffects(stop, { started: [id, id], finished: [id] })
  })

  it("waits for a preexisting direct attempt even when its target lookup returns null", async () => {
    const h = makeCloseHarness()
    const root = h.seed("root")
    const child = h.seed("child", root)
    const entered = deferred()
    const release = deferred()
    h.close.mockReturnValueOnce(release.promise)
    const direct = h.orch.deleteAndKill(child)
    h.get.mockImplementationOnce(async () => {
      entered.resolve()
      return null
    })
    const tree = h.orch.closeTree(root)
    await Promise.race([entered.promise, tree])
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(h.get.mock.calls).toEqual([[child]])
    h.expectEffects(stop, { started: [child], finished: [] })
    release.resolve()
    await direct
    expect(await tree).toEqual(expectClosed([child, root]))
    h.expectEffects(stop, { started: [child, root] })
  })

  it.each(["stale record", "rejection"])(
    "keeps a direct attempt that completes before get returns %s",
    async (outcome) => {
      const h = makeCloseHarness()
      const id = h.seed("target", undefined, "waiting")
      const entered = deferred()
      const lookup = deferred<Agent | null>()
      const agent = h.state.get(id) ?? null
      h.get.mockImplementationOnce(() => {
        entered.resolve()
        return lookup.promise
      })
      const tree = h.orch.closeTree(id)
      await Promise.race([entered.promise, tree])
      await h.orch.deleteAndKill(id)
      expect(h.state.has(id)).toBe(false)
      if (outcome === "rejection") lookup.reject(new Error("get failed after direct success"))
      else lookup.resolve(agent)

      expect(await tree).toEqual(expectClosed([id]))
      h.expectEffects(stop, { started: [id] })
      expect(h.getHost).not.toHaveBeenCalled()
    },
  )

  it("waits for all captured rejections and chooses the first error in start order", async () => {
    const h = makeCloseHarness()
    const root = h.seed("root")
    const child = h.seed("child", root)
    const reading = deferred()
    const lookup = deferred<Agent | null>()
    const firstClose = deferred()
    const secondClose = deferred()
    h.get.mockImplementationOnce(() => {
      reading.resolve()
      return lookup.promise
    })
    h.close.mockReturnValueOnce(firstClose.promise).mockReturnValueOnce(secondClose.promise)
    const tree = h.orch.closeTree(root)
    await Promise.race([reading.promise, tree])
    const first = h.orch.deleteAndKill(child)
    const second = h.orch.deleteAndKill(child)
    const firstFailure = expect(first).rejects.toThrow("first attempt")
    const secondFailure = expect(second).rejects.toThrow("second attempt")
    lookup.reject(new Error("lookup failure"))
    secondClose.reject(new Error("second attempt"))
    await secondFailure
    // Let the already-settled get and second attempt propagate while the first is held.
    await new Promise<void>((resolve) => setImmediate(resolve))
    h.expectEffects(stop, { started: [child, child], finished: [] })
    expect(h.get.mock.calls).toEqual([[child]])
    firstClose.reject(new Error("first attempt"))
    await firstFailure

    expect(await tree).toEqual({
      ...expectClosed([root]),
      failed: [{ agentId: child, error: "first attempt" }],
    })
    h.expectEffects(stop, { started: [child, child, root], finished: [root] })
    expect(await h.orch.closeTree(child)).toEqual(expectClosed([child]))
    h.expectEffects(stop, { started: [child, child, root, child], finished: [root, child] })
  })

  it("uses a mixed captured group without waiting for a direct attempt started after the cut", async () => {
    const h = makeCloseHarness()
    const root = h.seed("root")
    const child = h.seed("child", root)
    const reading = deferred()
    const lookup = deferred<Agent | null>()
    const firstClose = deferred()
    const secondClose = deferred()
    const lateClose = deferred()
    h.get.mockImplementationOnce(() => {
      reading.resolve()
      return lookup.promise
    })
    h.close
      .mockReturnValueOnce(firstClose.promise)
      .mockReturnValueOnce(secondClose.promise)
      .mockReturnValueOnce(lateClose.promise)

    const tree = h.orch.closeTree(root)
    await Promise.race([reading.promise, tree])
    const first = h.orch.deleteAndKill(child)
    const second = h.orch.deleteAndKill(child)
    const firstFailure = expect(first).rejects.toThrow("early failure")
    lookup.resolve(h.state.get(child) ?? null)
    // The resolved get continuation runs before this microtask, fixing the group.
    await lookup.promise
    const late = h.orch.deleteAndKill(child)
    firstClose.reject(new Error("early failure"))
    await firstFailure
    h.expectEffects(stop, { started: [child, child, child], finished: [] })
    expect(h.get.mock.calls).toEqual([[child]])
    secondClose.resolve()
    await second

    try {
      expect(await tree).toEqual(expectClosed([child, root]))
      h.expectEffects(stop, { started: [child, child, child, root], finished: [child, root] })
    } finally {
      lateClose.resolve()
      await late
    }
    h.expectEffects(stop, { started: [child, child, child, root], finished: [child, root, child] })
  })

  it("includes a direct attempt that starts synchronously inside getHost", async () => {
    const h = makeCloseHarness()
    const root = h.seed("parent")
    const id = h.seed("target", root, "waiting")
    const release = deferred()
    const started = deferred()
    let direct: Promise<void> | undefined
    h.close.mockImplementationOnce(() => {
      started.resolve()
      return release.promise
    })
    h.getHost.mockImplementationOnce(() => {
      direct = h.orch.deleteAndKill(id)
      return h.readHost(id)
    })
    const tree = h.orch.closeTree(root)
    await Promise.race([started.promise, tree])
    expect(direct).toBeInstanceOf(Promise)
    h.expectEffects(stop, { started: [id], finished: [] })
    release.resolve()
    await direct
    expect(await tree).toEqual(expectClosed([id, root]))
    h.expectEffects(stop, { started: [id, root] })
  })

  it("retains a busy host sample taken before a reentrant direct close", async () => {
    const h = makeCloseHarness()
    const root = h.seed("parent")
    const child = h.seed("target", root, "waiting")
    let direct: Promise<void> | undefined
    h.getHost.mockImplementationOnce((id) => {
      const host = h.readHost(id)
      direct = h.orch.deleteAndKill(id)
      return host
    })
    const entries: LogEntry[] = []
    const off = addSink((entry) => entries.push(entry))

    try {
      const result = await h.orch.closeTree(root)
      expect(direct).toBeInstanceOf(Promise)
      h.expectEffects(stop, { started: [child, root] })
      expect(result).toEqual(expectClosed([child, root], [child]))
      expect(
        entries.filter(
          (entry) =>
            entry.ns === "backend.orchestrator" && entry.msg === "closed a busy agent in the tree",
        ),
      ).toEqual([
        expect.objectContaining({
          level: "warn",
          fields: { agentId: child, wasTurnState: "waiting" },
        }),
      ])
    } finally {
      off()
    }
  })

  it("keeps direct close and crash cleanup scoped to the selected agent", async () => {
    const h = makeCloseHarness()
    const parent = h.seed("parent", undefined, "waiting")
    const child = h.seed("child", parent, "idle")
    const outsider = h.seed("outsider")
    recordAllowAlwaysGrant(outsider, parent, "close")
    recordAllowAlwaysGrant(outsider, child, "close")

    const direct = h.orch.deleteAndKill(parent)
    expect(h.hosts.has(parent)).toBe(false)
    expect(h.hosts.has(child)).toBe(true)
    expect(hasAllowAlwaysGrant(outsider, parent, "close")).toBe(false)
    expect(hasAllowAlwaysGrant(outsider, child, "close")).toBe(true)
    await direct
    expect(h.state.has(child)).toBe(true)
    await h.orch.deleteAndKill("a7-no-registry-entry")

    const crashed = h.seed("crashed-parent", undefined, "waiting")
    const crashChild = h.seed("crash-child", crashed, "idle")
    expect(h.crash.handler).toBeDefined()
    await h.crash.handler?.(crashed, { exitCode: 1, signal: null })
    expect(h.state.get(crashed)?.status).toBe("crashed")
    expect(h.hosts.has(crashed)).toBe(false)
    expect(h.state.get(crashChild)?.status).toBe("ready")
    expect(h.hosts.has(crashChild)).toBe(true)
    h.expectEffects(stop, {
      started: [parent, "a7-no-registry-entry", crashed],
      connected: [parent, "a7-no-registry-entry"],
      updates: [
        [parent, { status: "closed" }],
        ["a7-no-registry-entry", { status: "closed" }],
        [crashed, { status: "crashed", crashReason: "Exited with code 1" }],
      ],
    })
  })
})

type SourceUnderTest = { path: string; text: string }

const packagesDir = fileURLToPath(new URL("../../", import.meta.url))
const orchestratorPath = join(packagesDir, "backend/src/app/agent-orchestrator.ts")
const closeServicePath = join(packagesDir, "backend/src/app/agent-tree-close")
const excludedDirectories = new Set([
  "node_modules",
  "dist",
  "build",
  "generated",
  ".svelte-kit",
  ".git",
  ".tmp",
  "test",
  "tests",
  "fixtures",
  "__fixtures__",
  "__tests__",
  "__testing__",
  "vendor",
])

function* readProductionSources(directory: string): Generator<SourceUnderTest> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !excludedDirectories.has(entry.name)) {
      yield* readProductionSources(path)
    } else if (
      entry.isFile() &&
      /\.(?:[cm]?[jt]sx?|svelte)$/.test(entry.name) &&
      !/\.(?:test|spec|fixture|generated|gen|d)\./.test(entry.name)
    ) {
      yield { path, text: readFileSync(path, "utf8") }
    }
  }
}

function isInternalSignature(node: ts.Node): node is ts.MethodSignature {
  return (
    ts.isMethodSignature(node) &&
    ts.isTypeLiteralNode(node.parent) &&
    ts.isIntersectionTypeNode(node.parent.parent) &&
    ts.isTypeAliasDeclaration(node.parent.parent.parent) &&
    node.parent.parent.parent.name.text === "InternalAgentOrchestrator"
  )
}

function isFactoryAssignment(node: ts.Node): node is ts.PropertyAssignment {
  return (
    ts.isPropertyAssignment(node) &&
    ts.isObjectLiteralExpression(node.parent) &&
    ts.isReturnStatement(node.parent.parent) &&
    ts.isBlock(node.parent.parent.parent) &&
    ts.isFunctionDeclaration(node.parent.parent.parent.parent) &&
    node.parent.parent.parent.parent.name?.text === "createAgentOrchestrator"
  )
}

function findCloseTreeUsage(sources: Iterable<SourceUnderTest>): string[] {
  const violations: string[] = []
  let signatures = 0
  let assignments = 0
  let assemblyImports = 0
  for (const { path, text } of sources) {
    const occurrences = [...text.matchAll(/\bcloseTree\b/g)]
    const permittedMembers = new Set<number>()
    const scripts = path.endsWith(".svelte")
      ? Array.from(text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g), (match) => match[1] ?? "")
      : [text]

    for (const script of scripts) {
      const kind = /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      const source = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true, kind)
      function visit(node: ts.Node) {
        if (
          path === orchestratorPath &&
          (isInternalSignature(node) || isFactoryAssignment(node)) &&
          ts.isIdentifier(node.name) &&
          node.name.text === "closeTree"
        ) {
          permittedMembers.add(node.name.getStart(source))
          if (ts.isMethodSignature(node)) signatures++
          else assignments++
        }

        let specifier: ts.Node | undefined
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          specifier = node.moduleSpecifier
        } else if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword
        ) {
          specifier = node.arguments[0]
        }
        if (specifier && ts.isStringLiteralLike(specifier)) {
          const dest = resolve(dirname(path), specifier.text.replace(/\.[cm]?[jt]sx?$/, ""))
          if (dest === closeServicePath) {
            if (path === orchestratorPath && ts.isImportDeclaration(node)) assemblyImports++
            else violations.push(`close service referenced in ${path}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    for (const match of occurrences) {
      if (!permittedMembers.has(match.index)) violations.push(`closeTree found in ${path}`)
    }
  }
  if (signatures !== 1 || assignments !== 1) {
    violations.push(
      `expected one internal signature and one assignment, saw ${signatures} and ${assignments}`,
    )
  }
  if (assemblyImports !== 1) violations.push(`expected 1 assembly import, saw ${assemblyImports}`)
  return violations
}

describe("production wiring of the internal tree close capability", () => {
  const deliveryPath = join(packagesDir, "backend/src/delivery/fixture.ts")
  const compliantAssembly = {
    path: orchestratorPath,
    text: `
      import { createAgentTreeClose } from "./agent-tree-close.js"
      type InternalAgentOrchestrator = AgentOrchestrator & {
        closeTree(rootId: string): Promise<CloseTreeResult>
      }
      function createAgentOrchestrator() {
        return { closeTree: service.closeBranch }
      }
    `,
  }

  it("allows only the internal type and factory assignment and one assembly import", () => {
    expect(findCloseTreeUsage(readProductionSources(packagesDir))).toEqual([])
  })

  it("accepts a compliant fixture", () => {
    expect(findCloseTreeUsage([compliantAssembly])).toEqual([])
  })

  it.each([
    ["direct call", "orchestrator.closeTree(id)", "closeTree found"],
    ["bracket call", 'orchestrator["closeTree"](id)', "closeTree found"],
    ["destructuring", "const { closeTree: run } = orchestrator; run(id)", "closeTree found"],
    [
      "aliased helper",
      'import { createAgentTreeClose as build } from "../app/agent-tree-close.js"; build(deps)',
      "close service referenced",
    ],
    ["barrel export", 'export * from "../app/agent-tree-close"', "close service referenced"],
    [
      "literal dynamic import",
      'const helper = await import("../app/agent-tree-close.ts"); helper.createAgentTreeClose(deps)',
      "close service referenced",
    ],
  ])("rejects a delivery fixture with %s", (_, source, violation) => {
    expect(findCloseTreeUsage([compliantAssembly, { path: deliveryPath, text: source }])).toEqual([
      `${violation} in ${deliveryPath}`,
    ])
  })
})
