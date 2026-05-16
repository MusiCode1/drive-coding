import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { createInMemoryAgentRegistry } from "../src/agents/registry"
import { registerAgentsHttp } from "../src/delivery/http-agents"

function makeApp() {
  const app = new Hono()
  const registry = createInMemoryAgentRegistry()
  registerAgentsHttp(app, { registry })
  return { app, registry }
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
    it("creates with valid input", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliKind: "opencode", cwd: "/foo" }),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.agent.cliKind).toBe("opencode")
      expect(body.agent.status).toBe("ready")
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
      expect(body.agent.modelOverride).toBe("claude-sonnet-4")
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
})
