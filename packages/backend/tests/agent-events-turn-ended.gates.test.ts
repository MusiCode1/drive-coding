/**
 * agent-events-turn-ended.gates.test.ts — turn-ended without closeOnTurnEnd (slice be-events-subscribe C1).
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { AcpTransport } from "@drive-coding/provider/transport"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import { registerAgentsHttp } from "../src/delivery/http-agents.js"
import { setSelfBaseUrlForTests } from "../src/instances.js"
import { createAgentEventBus, type AgentEvent } from "../src/session-host/agent-events.js"
import { createTurnEndedEmitter } from "../src/session-host/agent-events-turn.js"
import { createAgentSessionRegistry } from "../src/session-host/registry.js"
import { createSessionHostFromConnection } from "../src/session-host/session-host.js"
import { serve } from "@hono/node-server"
import type { ServerType } from "@hono/node-server"
import { Hono } from "hono"

function makeMockConn(agentId: string): ProviderConnection {
  return {
    agentId,
    cliKind: "cursor",
    wire: { send: vi.fn(), onLine: () => () => {} },
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
    update: { sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" },
  } as SessionNotification
}

async function makeTurnEndedGateServer(eventBus = createAgentEventBus()) {
  const app = new Hono()
  const registry = createInMemoryAgentRegistry()
  const events: AgentEvent[] = []
  eventBus.onEvent((e) => events.push(e))

  const connectionRegistry = {
    get: vi.fn((id: string) => makeMockConn(id)),
    getCwd: vi.fn(() => "/tmp/turn-ended-gate"),
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
    onTurnEnded: createTurnEndedEmitter(eventBus),
    _createHostFn: async (conn, opts) =>
      createSessionHostFromConnection(conn, {
        ...opts,
        _createAcpClient: async (_transport: AcpTransport, callbacks: AcpClientCallbacks) => {
          const client: AcpClient = {
            newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
            loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
            prompt: vi.fn(async () => {
              callbacks.onUpdate?.(runningUpdate())
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
      await registry.delete(id).catch(() => {})
      agentSessionRegistry.unregisterHost(id)
    },
    getBridgePort: () => 0,
  }

  registerAgentsHttp(app, { registry, orchestrator, bridgeManager: connectionRegistry as never })
  const { registerRpcRoute } = await import("../src/session-host/http/rpc.js")
  registerRpcRoute(app, agentSessionRegistry)

  const server: ServerType = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" })
    s.on("listening", () => resolve(s))
  })
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0
  const base = `http://127.0.0.1:${port}`
  setSelfBaseUrlForTests(base)
  return {
    registry,
    events,
    base,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe("be-events-subscribe C1 turn-ended gate", () => {
  afterEach(() => {
    setSelfBaseUrlForTests(undefined)
  })

  it("bus.emit turn-ended without closeOnTurnEnd", async () => {
    const { registry, events, base, stop } = await makeTurnEndedGateServer()
    try {
      const createRes = await fetch(`${base}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliKind: "cursor", cwd: "/tmp/turn-ended-gate" }),
      })
      expect(createRes.status).toBe(201)
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
      expect(events.some((e) => e.kind === "turn-ended" && e.agentId === agentId)).toBe(true)
      const ended = events.find((e) => e.kind === "turn-ended")
      expect(ended?.stopReason).toBe("end_turn")
    } finally {
      await stop()
    }
  })
})
