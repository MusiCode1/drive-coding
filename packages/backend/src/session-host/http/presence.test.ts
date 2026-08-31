/**
 * presence.test.ts — TDD tests for POST /api/agents/:id/presence (slice liveness C1).
 */

import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { httpCacheInvalidateAll } from "../../delivery/http-cache.js"
import type { AgentSessionRegistry } from "../registry.js"
import { CONNECTION_ID_HEADER } from "./connection-id.js"
import { registerPresenceRoute } from "./presence.js"

beforeEach(() => {
  httpCacheInvalidateAll()
})

function makeMockRegistry(): AgentSessionRegistry {
  return {
    getHost: vi.fn().mockReturnValue(undefined),
    isHeld: vi.fn().mockReturnValue(false),
    getOrCreateHost: vi.fn().mockResolvedValue({ ok: false, reason: "not-found" }),
    getBroadcaster: vi.fn().mockReturnValue(undefined),
    unregisterHost: vi.fn(),
    notifySessionAttached: vi.fn().mockResolvedValue(undefined),
    getCwd: vi.fn().mockReturnValue(undefined),
    getCliKind: vi.fn(),
    getEpoch: vi.fn().mockReturnValue(0),
    touchConnection: vi.fn(),
    getRuntimeInfo: vi.fn().mockReturnValue({
      pid: 1234,
      attached: true,
      busy: false,
      lastMessageAt: null,
      lastSeenAt: Date.now(),
      via: "http",
    }),
    getConnectionCount: vi.fn().mockReturnValue(1),
    stop: vi.fn(),
  }
}

type MockResponse = {
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<{ ok: boolean; agent: unknown; machine: unknown }>
}

async function postPresence(
  app: Hono,
  agentId: string,
  headers?: Record<string, string>,
): Promise<MockResponse> {
  const res = await app.request(`/api/agents/${agentId}/presence`, {
    method: "POST",
    headers,
  })
  return res as unknown as MockResponse
}

function makeApp(registry: AgentSessionRegistry): Hono {
  const app = new Hono()
  registerPresenceRoute(app, registry)
  return app
}

describe("POST /api/agents/:id/presence", () => {
  it("calls touchConnection when Acp-Connection-Id header is present", async () => {
    const registry = makeMockRegistry()
    const app = makeApp(registry)

    const res = await postPresence(app, "agent-1", { [CONNECTION_ID_HEADER]: "conn-1" })
    expect(res.status).toBe(200)
    expect(registry.touchConnection).toHaveBeenCalledWith("agent-1", "conn-1")
  })

  it("does not call touchConnection without header", async () => {
    const registry = makeMockRegistry()
    const app = makeApp(registry)

    await postPresence(app, "agent-1")
    expect(registry.touchConnection).not.toHaveBeenCalled()
  })

  it("returns { ok: true, agent, machine }", async () => {
    const registry = makeMockRegistry()
    const app = makeApp(registry)

    const res = await postPresence(app, "agent-1", { [CONNECTION_ID_HEADER]: "c1" })
    expect(res.status).toBe(200)

    const json = (await res.json()) as {
      ok: boolean
      agent: { pid: number; attached: boolean; via: string } | null
      machine: { memPct: number; cpu: unknown }
    }
    expect(json.ok).toBe(true)
    expect(json.agent?.attached).toBe(true)
    expect(json.agent?.via).toBe("http")
    expect(typeof json.machine.memPct).toBe("number")
  })

  it("cache: 2 requests in window → touchConnection runs twice but getRuntimeInfo sampled once", async () => {
    const registry = makeMockRegistry()
    const app = makeApp(registry)
    const headers = { [CONNECTION_ID_HEADER]: "c1" }

    await postPresence(app, "agent-1", headers)
    await postPresence(app, "agent-1", headers)

    expect(registry.touchConnection).toHaveBeenCalledTimes(2)
    expect(registry.getRuntimeInfo).toHaveBeenCalledTimes(1)
  })
})
