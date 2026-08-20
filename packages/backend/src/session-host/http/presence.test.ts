/**
 * presence.test.ts — TDD tests for POST /api/agents/:id/presence (slice liveness C1).
 *
 * Testing: tdd (brief §C1)
 *
 * Tests:
 *   - touchOwner is called with the agentId (the liveness side effect)
 *   - 200 with { ok, agent, machine }
 *   - agent reflects registry.getRuntimeInfo
 *   - machine has the MachineStats shape (memPct/cpu)
 */

import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { httpCacheInvalidateAll } from "../../delivery/http-cache.js"
import type { AgentSessionRegistry } from "../registry.js"
import { registerPresenceRoute } from "./presence.js"

// המטמון הוא module-level — מנקים בין טסטים כדי שלא ידלוף ביניהם.
beforeEach(() => {
  httpCacheInvalidateAll()
})

// ── mock helpers ──────────────────────────────────────────────────────────────

function makeMockRegistry(): AgentSessionRegistry {
  return {
    getHost: vi.fn().mockReturnValue(undefined),
    isHeld: vi.fn().mockReturnValue(false),
    // slice host-result-reason C1: presence.ts never calls getOrCreateHost —
    // kept type-correct for hygiene (unused at runtime by this route).
    getOrCreateHost: vi.fn().mockResolvedValue({ ok: false, reason: "not-found" }),
    getBroadcaster: vi.fn().mockReturnValue(undefined),
    unregisterHost: vi.fn(),
    notifySessionAttached: vi.fn().mockResolvedValue(undefined),
    getCwd: vi.fn().mockReturnValue(undefined),
    getEpoch: vi.fn().mockReturnValue(0),
    touchOwner: vi.fn(),
    getRuntimeInfo: vi.fn().mockReturnValue({
      pid: 1234,
      attached: true,
      busy: false,
      lastMessageAt: null,
      via: "http",
    }),
  }
}

/**
 * MockResponse — structural subset of Response (calev-heavy L10, same as rpc.test.ts).
 * `app.request()` (Hono) declares its return type in terms of the ambient global
 * `Response`, which under this package's tsconfig (`types: ["bun"]`) conflicts with
 * DOM's `Response` — a direct `.status`/`.json()` access is a TS2339 error. The
 * local structural type sidesteps the ambiguous `Response` name entirely.
 */
type MockResponse = {
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<{ ok: boolean; agent: unknown; machine: unknown }>
}

async function postPresence(app: Hono, agentId: string): Promise<MockResponse> {
  const res = await app.request(`/api/agents/${agentId}/presence`, { method: "POST" })
  return res as unknown as MockResponse
}

function makeApp(registry: AgentSessionRegistry): Hono {
  const app = new Hono()
  registerPresenceRoute(app, registry)
  return app
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/agents/:id/presence", () => {
  it("calls touchOwner with the agentId from URL", async () => {
    const registry = makeMockRegistry()
    const app = makeApp(registry)

    const res = await postPresence(app, "agent-1")
    expect(res.status).toBe(200)
    expect(registry.touchOwner).toHaveBeenCalledWith("agent-1")
  })

  it("returns { ok: true, agent, machine }", async () => {
    const registry = makeMockRegistry()
    const app = makeApp(registry)

    const res = await postPresence(app, "agent-1")
    expect(res.status).toBe(200)

    const json = (await res.json()) as {
      ok: boolean
      agent: { pid: number; attached: boolean; via: string } | null
      machine: { memPct: number; cpu: unknown }
    }
    expect(json.ok).toBe(true)
    expect(json.agent).not.toBeNull()
    expect(json.agent?.attached).toBe(true)
    expect(json.agent?.via).toBe("http")
    expect(json.agent?.pid).toBe(1234)
    expect(json.machine).toBeDefined()
    expect(typeof json.machine.memPct).toBe("number")
  })

  it("agent is null when getRuntimeInfo returns null (unknown agentId)", async () => {
    const registry = makeMockRegistry()
    ;(registry.getRuntimeInfo as ReturnType<typeof vi.fn>).mockReturnValue(null)
    const app = makeApp(registry)

    const res = await postPresence(app, "ghost")
    expect(res.status).toBe(200)

    const json = (await res.json()) as { ok: boolean; agent: unknown }
    expect(json.ok).toBe(true)
    expect(json.agent).toBeNull()
  })

  it("works for a WS-owned agent (touchOwner is transport-agnostic)", async () => {
    const registry = makeMockRegistry()
    ;(registry.getRuntimeInfo as ReturnType<typeof vi.fn>).mockReturnValue({
      pid: 999,
      attached: true,
      busy: false,
      lastMessageAt: null,
      via: "ws",
    })
    const app = makeApp(registry)

    const res = await postPresence(app, "ws-agent")
    expect(res.status).toBe(200)
    expect(registry.touchOwner).toHaveBeenCalledWith("ws-agent")

    const json = (await res.json()) as { agent: { via: string } }
    expect(json.agent.via).toBe("ws")
  })

  it("sets Cache-Control: no-store (point-specific)", async () => {
    const registry = makeMockRegistry()
    const app = makeApp(registry)

    const res = await postPresence(app, "agent-1")
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  it("🔴 cache: 2 requests in window → touchOwner runs twice but getRuntimeInfo sampled once", async () => {
    const registry = makeMockRegistry()
    const app = makeApp(registry)

    await postPresence(app, "agent-1")
    await postPresence(app, "agent-1")

    // touchOwner הוא תופעת-הלוואי — רץ תמיד, בכל בקשה (החיות).
    expect(registry.touchOwner).toHaveBeenCalledTimes(2)
    // getRuntimeInfo (הדגימה) — פעם אחת בלבד (השנייה מהמטמון).
    expect(registry.getRuntimeInfo).toHaveBeenCalledTimes(1)
  })
})
