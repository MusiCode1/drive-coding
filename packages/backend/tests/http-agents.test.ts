import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import { createInMemoryAgentRegistry } from "../src/agents/registry"
import type { AgentOrchestrator, CreateAndSpawnResult } from "../src/app/agent-orchestrator"
import { registerAgentsHttp } from "../src/delivery/http-agents"

function makeApp() {
  const app = new Hono()
  const registry = createInMemoryAgentRegistry()

  /**
   * Mock orchestrator — Slice 10 API.
   * createAndSpawn now returns CreateAndSpawnResult (not Agent).
   */
  const orchestrator: AgentOrchestrator = {
    async createAndSpawn(input): Promise<CreateAndSpawnResult> {
      const agent = await registry.create(input)
      await registry.update(agent.id, { status: "ready", bridgePort: 7100 })
      return {
        agentId: agent.id,
        cwd: agent.cwd,
        cliKind: agent.cliKind,
        wsUrl: `ws://127.0.0.1:7100/`,
        bridgePort: 7100,
        status: "spawning",
      }
    },
    async deleteAndKill(id) {
      await registry.delete(id).catch(() => {})
    },
    getBridgePort: vi.fn(() => 7100),
  }

  registerAgentsHttp(app, { registry, orchestrator })
  return { app, registry, orchestrator }
}

describe("HTTP /api/agents", () => {
  describe("GET /api/agents", () => {
    it("returns empty list", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents")
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ agents: [] })
    })

    it("returns created agents", async () => {
      const { app, registry } = makeApp()
      await registry.create({ cliKind: "opencode", cwd: "/x" })
      const res = await app.request("/api/agents")
      const body = await res.json()
      expect(body.agents).toHaveLength(1)
    })

    it("does not expose bridge fields", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      // manually inject bridge fields to simulate future state
      await registry.update(agent.id, { bridgePort: 7100, acpSessionId: "sess_abc" })
      const res = await app.request("/api/agents")
      const body = await res.json()
      expect(body.agents[0]).not.toHaveProperty("bridgePort")
      expect(body.agents[0]).not.toHaveProperty("acpSessionId")
    })
  })

  describe("POST /api/agents", () => {
    it("creates with valid input — returns CreateAndSpawnResult", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliKind: "opencode", cwd: "/foo" }),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      // Slice 10: response is CreateAndSpawnResult, not { agent: AgentPublic }
      expect(body.agentId).toBeTruthy()
      expect(body.cliKind).toBe("opencode")
      expect(body.status).toBe("spawning")
      expect(typeof body.bridgePort).toBe("number")
    })

    it("creates agent and returns wsUrl + bridgePort", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliKind: "opencode", cwd: "/tmp" }),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.wsUrl).toBeTruthy()
      expect(body.bridgePort).toBe(7100)
    })

    it("rejects empty cwd", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliKind: "opencode", cwd: "" }),
      })
      expect(res.status).toBe(400)
    })

    it("rejects invalid json", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
      expect(res.status).toBe(400)
    })

    it("rejects invalid cliKind", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliKind: "vim", cwd: "/foo" }),
      })
      expect(res.status).toBe(400)
    })

    it("creates with modelOverride", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliKind: "claude", cwd: "/x", modelOverride: "claude-sonnet-4" }),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.cwd).toBe("/x")
    })

    it("returns 500 if orchestrator throws", async () => {
      const app = new Hono()
      const registry = createInMemoryAgentRegistry()
      const failingOrchestrator: AgentOrchestrator = {
        async createAndSpawn() {
          throw new Error("bridge spawn failed")
        },
        async deleteAndKill() {},
        getBridgePort: vi.fn(() => null),
      }
      registerAgentsHttp(app, { registry, orchestrator: failingOrchestrator })

      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliKind: "opencode", cwd: "/tmp" }),
      })
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toContain("bridge spawn failed")
    })
  })

  describe("GET /api/agents/:id", () => {
    it("returns existing agent", async () => {
      const { app, registry } = makeApp()
      const created = await registry.create({ cliKind: "opencode", cwd: "/x" })
      const res = await app.request(`/api/agents/${created.id}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.agent.id).toBe(created.id)
    })

    it("404 for unknown", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents/unknown")
      expect(res.status).toBe(404)
    })
  })

  describe("DELETE /api/agents/:id", () => {
    it("deletes existing", async () => {
      const { app, registry } = makeApp()
      const created = await registry.create({ cliKind: "opencode", cwd: "/x" })
      const res = await app.request(`/api/agents/${created.id}`, { method: "DELETE" })
      expect(res.status).toBe(204)
      expect(await registry.get(created.id)).toBeNull()
    })

    it("404 for unknown", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents/unknown", { method: "DELETE" })
      expect(res.status).toBe(404)
    })
  })

  describe("POST /api/agents/:id/session-attached", () => {
    it("marks agent ready and returns { ok: true }", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { status: "starting" })

      const res = await app.request(`/api/agents/${agent.id}/session-attached`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "sess-abc123" }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })

      // Verify registry was updated
      const updated = await registry.get(agent.id)
      expect(updated?.status).toBe("ready")
      expect(updated?.acpSessionId).toBe("sess-abc123")
    })

    it("404 for unknown agent", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents/ghost/session-attached", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "s1" }),
      })
      expect(res.status).toBe(404)
    })

    it("400 if sessionId missing", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      const res = await app.request(`/api/agents/${agent.id}/session-attached`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it("409 if agent already ready with different sessionId", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { status: "ready", acpSessionId: "existing-session" })

      const res = await app.request(`/api/agents/${agent.id}/session-attached`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "different-session" }),
      })
      expect(res.status).toBe(409)
    })

    it("idempotent: same sessionId on ready agent → 200", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { status: "ready", acpSessionId: "same-session" })

      const res = await app.request(`/api/agents/${agent.id}/session-attached`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "same-session" }),
      })
      expect(res.status).toBe(200)
    })
  })
})
