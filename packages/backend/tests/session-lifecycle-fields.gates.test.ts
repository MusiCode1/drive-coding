/**
 * session-lifecycle-fields.gates.test.ts — §6 gate evidence (slice session-lifecycle-fields).
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { AcpTransport } from "@drive-coding/provider/transport"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import { waitForTurnEnd } from "../src/cli/wait-for-turn.js"
import { registerAgentsHttp } from "../src/delivery/http-agents.js"
import { resolveCloseOnTurnEndGraceMs } from "../src/session-host/close-on-turn-end.js"
import { createAgentSessionRegistry } from "../src/session-host/registry.js"
import { createSessionHostFromConnection } from "../src/session-host/session-host.js"
import { serve } from "@hono/node-server"
import type { ServerType } from "@hono/node-server"
import { Hono } from "hono"

function makeMockConn(agentId: string): ProviderConnection {
  return {
    agentId,
    cliKind: "cursor",
    wire: {
      send: vi.fn(),
      onLine: () => () => {},
    },
    onCrash: () => () => {},
    close: vi.fn(),
    pid: null,
  } as unknown as ProviderConnection
}

function runningUpdate(): SessionNotification {
  return {
    sessionId: "s1",
    update: { sessionUpdate: "state_update", state: "running" },
  } as SessionNotification
}

function idleEndTurnUpdate(): SessionNotification {
  return {
    sessionId: "s1",
    update: {
      sessionUpdate: "state_update",
      state: "idle",
      stopReason: "end_turn",
    },
  } as SessionNotification
}

async function makeGateServer() {
  const app = new Hono()
  const registry = createInMemoryAgentRegistry()
  const deleted: string[] = []
  let orchestratorRef: { deleteAndKill: (id: string) => Promise<void> } | null = null

  const connectionRegistry = {
    get: vi.fn((id: string) => makeMockConn(id)),
    getCwd: vi.fn(() => "/tmp/gates"),
    getCliKind: vi.fn(() => "cursor"),
    isOwnedByWs: vi.fn(() => false),
    getOwner: vi.fn(() => ({ via: "http" as const })),
    getLastSeenAt: vi.fn(() => Date.now()),
    getEpoch: vi.fn(() => 0),
    getRuntimeInfo: vi.fn(() => ({
      pid: null,
      attached: true,
      busy: false,
      lastMessageAt: null,
      lastSeenAt: Date.now(),
      via: "http" as const,
    })),
    markOwned: vi.fn(),
    markDetached: vi.fn(),
    touchOwner: vi.fn(),
  }

  const agentSessionRegistry = createAgentSessionRegistry({
    connectionRegistry: connectionRegistry as never,
    getCloseOnTurnEnd: async (agentId) => (await registry.get(agentId))?.closeOnTurnEnd === true,
    onScheduleCloseOnTurnEnd: (agentId) => {
      const graceMs = resolveCloseOnTurnEndGraceMs(process.env.CLOSE_ON_TURN_END_GRACE_MS)
      setTimeout(() => {
        void orchestratorRef?.deleteAndKill(agentId)
      }, graceMs)
    },
    _createHostFn: async (conn, opts) =>
      createSessionHostFromConnection(conn, {
        ...opts,
        _createAcpClient: async (_transport: AcpTransport, callbacks: AcpClientCallbacks) => {
          const client: AcpClient = {
            newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
            loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
            prompt: vi.fn(async () => {
              callbacks.onUpdate?.(runningUpdate())
              callbacks.onUpdate?.(idleEndTurnUpdate())
            }),
            cancel: vi.fn().mockResolvedValue(undefined),
            conn: {} as AcpClient["conn"],
            capabilities: {},
            setSessionMode: vi.fn(),
            setSessionConfigOption: vi.fn(),
            extMethod: vi.fn(),
            setSessionModel: vi.fn(),
            listSessions: vi.fn(),
            deleteSession: vi.fn(),
          }
          return client
        },
      }),
  })

  const orchestrator = {
    async createAndSpawn(input: Parameters<typeof registry.create>[0]) {
      const agent = await registry.create(input)
      return {
        agentId: agent.id,
        cwd: agent.cwd,
        cliKind: agent.cliKind,
        wsUrl: "",
        bridgePort: 0,
        status: "ready" as const,
      }
    },
    async deleteAndKill(id: string) {
      deleted.push(id)
      await registry.delete(id).catch(() => {})
      agentSessionRegistry.unregisterHost(id)
    },
    getBridgePort: () => 0,
  }
  orchestratorRef = orchestrator

  registerAgentsHttp(app, { registry, orchestrator, bridgeManager: connectionRegistry as never })
  const { registerEventsRoute } = await import("../src/session-host/http/events.js")
  registerEventsRoute(app, agentSessionRegistry)
  const { registerRpcRoute } = await import("../src/session-host/http/rpc.js")
  registerRpcRoute(app, agentSessionRegistry)

  const server: ServerType = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" })
    s.on("listening", () => resolve(s))
  })
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0
  const base = `http://127.0.0.1:${port}`
  return {
    app,
    registry,
    deleted,
    base,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

describe("session-lifecycle-fields §6 gates", () => {
  beforeEach(() => {
    process.env.CLOSE_ON_TURN_END_GRACE_MS = "0"
  })
  afterEach(() => {
    delete process.env.CLOSE_ON_TURN_END_GRACE_MS
  })

  it("gate 1+2: closeOnTurnEnd removes agent; waiter code 0 stopReason=end_turn", async () => {
    const { registry, deleted, base, stop } = await makeGateServer()
    try {
      const createRes = await fetch(`${base}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliKind: "cursor",
          cwd: "/tmp/gates",
          closeOnTurnEnd: true,
        }),
      })
      expect(createRes.status).toBe(201)
      const { agentId } = (await createRes.json()) as { agentId: string }

      const waitP = waitForTurnEnd({ base, agent: agentId, timeoutMs: 10_000 })

      const promptRes = await fetch(`${base}/api/agents/${agentId}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "session/prompt",
          params: { sessionId: "s1", content: "hi" },
        }),
      })
      expect(promptRes.status).toBe(202)

      // grace=0 → next tick delete
      await new Promise((r) => setTimeout(r, 50))

      const waitResult = await waitP
      expect(waitResult.code).toBe(0)
      expect(waitResult.stopReason).toBe("end_turn")
      expect(await registry.get(agentId)).toBeNull()
      expect(deleted).toContain(agentId)
    } finally {
      await stop()
    }
  })

  it("gate 3: default agent stays after turn end", async () => {
    const { registry, base, stop } = await makeGateServer()
    try {
      const createRes = await fetch(`${base}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliKind: "cursor", cwd: "/tmp/gates" }),
      })
      const { agentId } = (await createRes.json()) as { agentId: string }
      await fetch(`${base}/api/agents/${agentId}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "session/prompt",
          params: { sessionId: "s1", content: "hi" },
        }),
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(await registry.get(agentId)).not.toBeNull()
    } finally {
      await stop()
    }
  })

  it("gate 6: parentAgentId in GET /api/agents", async () => {
    const { base, stop } = await makeGateServer()
    try {
      await fetch(`${base}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliKind: "cursor",
          cwd: "/tmp/gates",
          parentAgentId: "parent-x",
        }),
      })
      const list = await fetch(`${base}/api/agents`)
      const body = (await list.json()) as { agents: { parentAgentId?: string }[] }
      expect(body.agents[0]?.parentAgentId).toBe("parent-x")
    } finally {
      await stop()
    }
  })
})
