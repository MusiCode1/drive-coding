/**
 * http-health.test.ts — integration test for GET /api/diag.
 *
 * Approach: integration — spin up a minimal Hono app with registerHealthHttp,
 * send a real HTTP request, validate the response shape.
 */

import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { registerHealthHttp } from "./http-health.js"

// ── minimal stubs ─────────────────────────────────────────────────────────────

import type { AgentRegistry } from "@drive-coding/core"

const stubRegistry: Pick<AgentRegistry, "list"> = {
  async list() {
    return [
      {
        id: "agent-1",
        cliKind: "opencode" as const,
        cwd: "/tmp",
        modelOverride: null,
        status: "ready" as const,
        createdAt: new Date().toISOString(),
        persistent: false,
      },
      {
        id: "agent-2",
        cliKind: "claude" as const,
        cwd: "/tmp",
        modelOverride: null,
        status: "ready" as const,
        createdAt: new Date().toISOString(),
        persistent: false,
      },
    ]
  },
}

const stubConnectionRegistry = {
  getRuntimeInfo(id: string) {
    if (id === "agent-1")
      return { pid: 1234, attached: true, busy: false, lastMessageAt: Date.now() - 500 }
    if (id === "agent-2") return { pid: null, attached: false, busy: true, lastMessageAt: null }
    return null
  },
}

// ── test ──────────────────────────────────────────────────────────────────────

describe("GET /api/diag", () => {
  it("returns 200 with required shape: eventLoop, memory, agents", async () => {
    const app = new Hono()
    registerHealthHttp(app, {
      registry: stubRegistry as unknown as AgentRegistry,
      connectionRegistry: stubConnectionRegistry,
    })

    const res = await app.request("/api/diag")
    const r = res as unknown as { status: number; json(): Promise<unknown> }
    expect(r.status).toBe(200)

    const body = (await r.json()) as Record<string, unknown>

    // top-level fields
    expect(typeof body.ts).toBe("number")
    expect(typeof body.uptimeMs).toBe("number")

    // eventLoop shape — values may be null when histogram has no samples yet (fresh start)
    // or a number (nanoseconds converted to ms). Both are valid: the key must exist.
    const el = body.eventLoop as Record<string, unknown>
    expect(el).toBeDefined()
    expect("meanMs" in el).toBe(true)
    expect("maxMs" in el).toBe(true)
    expect("p99Ms" in el).toBe(true)
    expect("stddevMs" in el).toBe(true)
    // When non-null, values must be numbers
    if (el.meanMs !== null) expect(typeof el.meanMs).toBe("number")
    if (el.maxMs !== null) expect(typeof el.maxMs).toBe("number")

    // memory shape
    const mem = body.memory as Record<string, unknown>
    expect(mem).toBeDefined()
    expect(typeof mem.rssMB).toBe("number")
    expect(mem.rssMB).toBeGreaterThan(0)
    expect(typeof mem.heapUsedMB).toBe("number")
    expect(typeof mem.heapTotalMB).toBe("number")
    expect(typeof mem.externalMB).toBe("number")

    // agents shape
    const agents = body.agents as { total: number; busy: number; list: unknown[] }
    expect(agents).toBeDefined()
    expect(agents.total).toBe(2)
    expect(agents.busy).toBe(1) // agent-2 is busy
    expect(Array.isArray(agents.list)).toBe(true)
    expect(agents.list).toHaveLength(2)

    // per-agent item shape
    const item0 = agents.list[0] as Record<string, unknown>
    expect(item0.agentId).toBe("agent-1")
    expect(item0.cliKind).toBe("opencode")
    expect(item0.pid).toBe(1234)
    expect(item0.busy).toBe(false)
    expect(item0.attached).toBe(true)
    expect(typeof item0.lastMessageAgoMs).toBe("number")

    const item1 = agents.list[1] as Record<string, unknown>
    expect(item1.agentId).toBe("agent-2")
    expect(item1.pid).toBeNull()
    expect(item1.busy).toBe(true)
    expect(item1.lastMessageAgoMs).toBeNull()
  })

  it("includes agents from registry even when connectionRegistry has no entry", async () => {
    const app = new Hono()
    const emptyConnReg = { getRuntimeInfo: () => null }
    registerHealthHttp(app, {
      registry: stubRegistry as unknown as AgentRegistry,
      connectionRegistry: emptyConnReg,
    })

    const res = await app.request("/api/diag")
    const r = res as unknown as { status: number; json(): Promise<unknown> }
    expect(r.status).toBe(200)
    const body = (await r.json()) as { agents: { total: number; busy: number } }
    expect(body.agents.total).toBe(2)
    expect(body.agents.busy).toBe(0) // all default to busy=false
  })
})
