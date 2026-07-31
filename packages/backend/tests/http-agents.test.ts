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

    it("strips bridgePort but exposes acpSessionId (Slice 10)", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { bridgePort: 7100, acpSessionId: "sess_abc" })
      const res = await app.request("/api/agents")
      const body = await res.json()
      expect(body.agents[0]).not.toHaveProperty("bridgePort")
      // Slice 10: acpSessionId is exposed — FE needs it on reload for loadSession()
      expect(body.agents[0].acpSessionId).toBe("sess_abc")
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

    it("rejects unknown cliKind (open-cli-registry: not in the effective registry, not a schema failure)", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliKind: "vim", cwd: "/foo" }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body).toHaveProperty("known")
      expect(Array.isArray(body.known)).toBe(true)
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

    // slice project-system-prompt Commit 1 — systemPrompt accepted by CreateAgentInputFull
    // and forwarded to orchestrator.createAndSpawn.
    it("creates with systemPrompt — accepted by schema and forwarded to orchestrator", async () => {
      let received: unknown
      const app = new Hono()
      const registry = createInMemoryAgentRegistry()
      const orchestrator: AgentOrchestrator = {
        async createAndSpawn(input): Promise<CreateAndSpawnResult> {
          received = input
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

      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliKind: "claude",
          cwd: "/x",
          systemPrompt: "Always end every reply with QAZ",
        }),
      })
      expect(res.status).toBe(201)
      expect((received as { systemPrompt?: string | null })?.systemPrompt).toBe(
        "Always end every reply with QAZ",
      )
    })

    it("creates without systemPrompt — omitted (not required)", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliKind: "claude", cwd: "/x" }),
      })
      expect(res.status).toBe(201)
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

    it("409 without replace flag: guard MED-9 stays active, registry unchanged", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { status: "ready", acpSessionId: "session-A" })

      const res = await app.request(`/api/agents/${agent.id}/session-attached`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-B" }), // no replace flag
      })
      expect(res.status).toBe(409)

      // Registry must remain unchanged — staleness guard worked
      const unchanged = await registry.get(agent.id)
      expect(unchanged?.acpSessionId).toBe("session-A")
    })

    it("200 with replace:true: warm switch overwrites sessionId in registry", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { status: "ready", acpSessionId: "session-A" })

      const res = await app.request(`/api/agents/${agent.id}/session-attached`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-B", replace: true }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })

      // Registry must be updated to the new sessionId
      const updated = await registry.get(agent.id)
      expect(updated?.acpSessionId).toBe("session-B")
      expect(updated?.status).toBe("ready")
    })
  })

  // slice active-agents: POST /api/agents/:id/persistent
  describe("POST /api/agents/:id/persistent", () => {
    it("sets persistent: true → 200 { ok: true } and updates registry", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })

      const res = await app.request(`/api/agents/${agent.id}/persistent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistent: true }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })

      const updated = await registry.get(agent.id)
      expect(updated?.persistent).toBe(true)
    })

    it("sets persistent: false → 200 { ok: true } and updates registry", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { persistent: true })

      const res = await app.request(`/api/agents/${agent.id}/persistent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistent: false }),
      })
      expect(res.status).toBe(200)
      const updated = await registry.get(agent.id)
      expect(updated?.persistent).toBe(false)
    })

    it("non-boolean body → 400", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })

      const res = await app.request(`/api/agents/${agent.id}/persistent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistent: "yes" }),
      })
      expect(res.status).toBe(400)
    })

    it("missing persistent field → 400", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })

      const res = await app.request(`/api/agents/${agent.id}/persistent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it("invalid json → 400", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })

      const res = await app.request(`/api/agents/${agent.id}/persistent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
      expect(res.status).toBe(400)
    })

    it("unknown agent → 404", async () => {
      const { app } = makeApp()

      const res = await app.request("/api/agents/ghost/persistent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistent: true }),
      })
      expect(res.status).toBe(404)
    })
  })

  // slice session-title-in-process-list: PATCH /api/agents/:id (generic, whitelist: title)
  describe("PATCH /api/agents/:id", () => {
    it("sets title → 200 {ok}, and GET /api/agents reflects it", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "מה זה TypeScript" }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })

      const listRes = await app.request("/api/agents")
      const listBody = await listRes.json()
      const found = listBody.agents.find((a: { id: string }) => a.id === agent.id)
      expect(found.title).toBe("מה זה TypeScript")
    })

    it("rejects unknown field (status) — whitelist protects runtime fields", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { status: "ready" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "hi", status: "crashed" }),
      })
      expect(res.status).toBe(400)

      // status must remain unchanged — whitelist blocked the whole request
      const unchanged = await registry.get(agent.id)
      expect(unchanged?.status).toBe("ready")
      expect(unchanged?.title).toBeUndefined()
    })

    it("404 for unknown agent", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents/ghost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "hi" }),
      })
      expect(res.status).toBe(404)
    })

    it("invalid json → 400", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
      expect(res.status).toBe(400)
    })

    it("title: null clears the title", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { title: "old title" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: null }),
      })
      expect(res.status).toBe(200)
      const updated = await registry.get(agent.id)
      expect(updated?.title).toBeNull()
    })

    it("omitted title (empty body) → no-op, existing title preserved", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { title: "keep me" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(200)
      const updated = await registry.get(agent.id)
      expect(updated?.title).toBe("keep me")
    })
  })

  // slice active-agents: GET /api/agents enriched with pid + attached via bridgeManager mock
  describe("GET /api/agents — runtime enrichment (bridgeManager mock)", () => {
    it("returns pid and attached when bridgeManager provided", async () => {
      const app = new Hono()
      const registry = createInMemoryAgentRegistry()
      const orchestrator: AgentOrchestrator = {
        async createAndSpawn(input): Promise<CreateAndSpawnResult> {
          const agent = await registry.create(input)
          return {
            agentId: agent.id,
            cwd: agent.cwd,
            cliKind: agent.cliKind,
            wsUrl: "ws://127.0.0.1:7100/",
            bridgePort: 7100,
            status: "spawning",
          }
        },
        async deleteAndKill(id) {
          await registry.delete(id).catch(() => {})
        },
        getBridgePort: vi.fn(() => 7100),
      }

      const bridgeManager = {
        // slice agent-busy-indicator: busy נוסף ל-return type
        getRuntimeInfo: vi.fn((_id: string) => ({
          pid: 12345,
          attached: true,
          busy: false,
          lastMessageAt: null,
        })),
      }

      registerAgentsHttp(app, { registry, orchestrator, bridgeManager })

      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      const res = await app.request("/api/agents")
      expect(res.status).toBe(200)
      const body = await res.json()
      const agentData = body.agents.find((a: { id: string }) => a.id === agent.id)
      expect(agentData).toBeDefined()
      expect(agentData.pid).toBe(12345)
      expect(agentData.attached).toBe(true)
    })

    it("does not include pid/attached when bridgeManager not provided (existing call-sites)", async () => {
      // The 2 existing makeApp() call-sites do not pass bridgeManager — guard ?. handles this
      const { app, registry } = makeApp()
      await registry.create({ cliKind: "opencode", cwd: "/x" })
      const res = await app.request("/api/agents")
      const body = await res.json()
      expect(body.agents[0]).not.toHaveProperty("pid")
      expect(body.agents[0]).not.toHaveProperty("attached")
    })
  })
})
