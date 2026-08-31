import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInMemoryAgentRegistry } from "../src/agents/registry"
import type { AgentOrchestrator, CreateAndSpawnResult } from "../src/app/agent-orchestrator"
import { registerAgentsHttp } from "../src/delivery/http-agents"
// slice liveness C2: ה-http-cache הוא module-level — מנקים בין טסטים כדי שלא ידלוף.
import { httpCacheInvalidateAll } from "../src/delivery/http-cache"

beforeEach(() => {
  httpCacheInvalidateAll()
})

// עזר-בדיקה: זיוף projectsRegistry עם ריגול (vi.fn) — עדיף על דיסק אמיתי
// כדי לבדוק במפורש *האם* ותחת אילו ארגומנטים הוא נקרא (D7).
function makeFakeProjectsRegistry() {
  return {
    recordCwd: vi.fn(async () => {}),
    recordSession: vi.fn(async () => {}),
    removeCwd: vi.fn(async () => {}),
    getProjects: vi.fn(async () => []),
  }
}

function makeApp(opts?: { projectsRegistry?: ReturnType<typeof makeFakeProjectsRegistry> }) {
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

  registerAgentsHttp(app, { registry, orchestrator, projectsRegistry: opts?.projectsRegistry, env: process.env })
  return { app, registry, orchestrator }
}

describe("HTTP /api/agents", () => {
  describe("GET /api/agents", () => {
    it("returns empty list", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents")
      expect(res.status).toBe(200)
      // slice liveness C2: no-store נקודתי על GET /api/agents.
      expect(res.headers.get("Cache-Control")).toBe("no-store")
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
      registerAgentsHttp(app, { registry, orchestrator, env: process.env })

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

    // slice session-create-contract C1 — permissionPolicy accepted + forwarded; absence unchanged.
    it("creates with permissionPolicy — accepted by schema and forwarded to orchestrator", async () => {
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
      registerAgentsHttp(app, { registry, orchestrator, env: process.env })

      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliKind: "claude",
          cwd: "/x",
          permissionPolicy: "allow_once",
        }),
      })
      expect(res.status).toBe(201)
      expect((received as { permissionPolicy?: string })?.permissionPolicy).toBe("allow_once")
    })

    it("POST without permissionPolicy — same as before (regression)", async () => {
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
      registerAgentsHttp(app, { registry, orchestrator, env: process.env })

      const res = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliKind: "claude", cwd: "/x" }),
      })
      expect(res.status).toBe(201)
      expect(received).toEqual(
        expect.objectContaining({ cliKind: "claude", cwd: "/x" }),
      )
      expect(received).not.toHaveProperty("permissionPolicy")
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
      registerAgentsHttp(app, { registry, orchestrator: failingOrchestrator, env: process.env })

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

  // slice agent-patch-unify C1: שני handlers ישנים (POST session-attached,
  // POST persistent) בוטלו — הסמנטיקה שלהם הוגרה לכאן, ל-PATCH /api/agents/:id
  // הגנרי. שינוי-מעטפת: sessionId → acpSessionId (השם שכבר קיים ב-Agent).
  describe("PATCH /api/agents/:id — attach (migrated from POST session-attached)", () => {
    it("marks agent ready and returns { ok: true }", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { status: "starting" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acpSessionId: "sess-abc123", status: "ready" }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })

      const updated = await registry.get(agent.id)
      expect(updated?.status).toBe("ready")
      expect(updated?.acpSessionId).toBe("sess-abc123")
    })

    it("404 for unknown agent", async () => {
      const { app } = makeApp()
      const res = await app.request("/api/agents/ghost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acpSessionId: "s1", status: "ready" }),
      })
      expect(res.status).toBe(404)
    })

    // הטסט הישן "400 if sessionId missing" (גוף {}) אינו מהגר 1:1: תחת המודל
    // המאוחד sessionId (=acpSessionId) אינו נדרש לבדו — {} הוא no-op חוקי
    // (כמו "omitted title" למטה). הכוונה המקורית — "נסיון-attach בלי מזהה"
    // — מכוסה ע"י טסטי D2 (status-alone / cwd-alone) בהמשך הקובץ.

    // 🔴 D3 — הטסט הקריטי: {acpSessionId} *בלי* status על agent ready עם
    // סשן אחר → 409. השומר קורא agent.status/agent.acpSessionId, לא
    // parsed.status/parsed.acpSessionId. קריאה הפוכה (parsed.status) הייתה
    // מאפשרת PATCH {acpSessionId:"hijack"} לבדו (חוקי תחת D2) לדרוס בשקט.
    it("🔴 409: acpSessionId alone (no status) on ready agent with different session — D3 reads agent.*, not parsed.*", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { status: "ready", acpSessionId: "existing-session" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acpSessionId: "different-session" }), // בכוונה בלי status
      })
      expect(res.status).toBe(409)

      // הרישום נשאר ללא שינוי — השומר חסם לפני שהעדכון נגע ברישום
      const unchanged = await registry.get(agent.id)
      expect(unchanged?.acpSessionId).toBe("existing-session")
    })

    it("idempotent: same acpSessionId (no status) on ready agent → 200", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { status: "ready", acpSessionId: "same-session" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acpSessionId: "same-session" }),
      })
      expect(res.status).toBe(200)
    })

    it("200 with replace:true: warm switch overwrites acpSessionId despite guard", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { status: "ready", acpSessionId: "session-A" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acpSessionId: "session-B", replace: true }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })

      const updated = await registry.get(agent.id)
      expect(updated?.acpSessionId).toBe("session-B")
      expect(updated?.status).toBe("ready")
    })
  })

  // slice agent-patch-unify C1: הסמנטיקה של POST persistent הוגרה ל-PATCH.
  // "missing field → 400" ו-"unknown agent → 404" הישנים מתלכדים עם טסטים
  // גנריים קיימים ("omitted title (empty body) → no-op", "404 for unknown
  // agent" למעלה) — לא כפולים במכוון.
  describe("PATCH /api/agents/:id — persistent (migrated from POST persistent)", () => {
    it("sets persistent: true → 200 { ok: true } and updates registry", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
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

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
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

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistent: "yes" }),
      })
      expect(res.status).toBe(400)
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

    // 🟢 D1 — status עכשיו מוצהר בסכימה, אבל מצומצם לליטרל "ready". הטסט הזה
    // שורד כלשונו: "crashed" נדחה (400). שים לב: גוף הבקשה הזה חסר acpSessionId,
    // ולכן D2 (צימוד) *גם הוא* היה מחזיר 400 בפני עצמו — הטסט הזה מוגן בשתי
    // שכבות בו-זמנית ולכן **אינו** מבחין לבדו בין M1 (D1) ל-M2 (D2). הבחנה
    // מבודדת ל-D1 ר' בטסט הבא, שמראה acpSessionId (חוסם את D2) + status:"crashed".
    it("rejects status:'crashed' — whitelist + D1 both reject (belt and suspenders)", async () => {
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

    // 🔴 D1 מבודד מ-D2 — נמדד: גוף עם title+status בלבד (הטסט הקודם) נחסם גם
    // ע"י D2 (חסר acpSessionId), ולכן M1 (הסרת הליטרל) אינו מפיל אותו. הטסט
    // הזה, בדיוק כמו שורת status-bad בפרוב, מוסיף acpSessionId כדי לחסום את
    // D2 ולבודד את D1 — זה הטסט ש-M1 באמת מפיל ברמת ה-unit (לא רק בפרוב).
    it("🔴 rejects status:'crashed' with acpSessionId present — D1 isolated from D2 (matches probe row status-bad)", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acpSessionId: "s1", status: "crashed" }),
      })
      expect(res.status).toBe(400)
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

    // מחלקה 3 — "לעולם-לא-מ-HTTP": onUndeclaredKey("reject") נדחית גם אחרי
    // הצטרפות השדות האופציונליים החדשים. (M6 מסירה את השכבה הזו.)
    it.each([
      ["bridgePort", { bridgePort: 9999 }],
      ["crashReason", { crashReason: "x" }],
      ["id", { id: "other" }],
    ])("rejects undeclared field %s → 400 (class-3 whitelist)", async (_label, extra) => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(extra),
      })
      expect(res.status).toBe(400)
    })

    // D2 — צימוד: status/cwd בלי acpSessionId → 400. הבדיקה חייבת לרוץ *לפני*
    // registry.get — אחרת agent לא-קיים יחזיר 404 במקום 400 (§3.5 סדר-הבדיקות).
    it("status alone (no acpSessionId) → 400 (D2 coupling)", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ready" }),
      })
      expect(res.status).toBe(400)
    })

    it("cwd alone (no acpSessionId) → 400 (D2 coupling)", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: "/tmp" }),
      })
      expect(res.status).toBe(400)
    })

    // D5 — cwd עובר validateCwd, בדיוק כמו ב-POST /api/agents. נתיב יחסי לא-חוקי.
    it("invalid cwd → 400 (D5 validateCwd)", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acpSessionId: "s1", cwd: "relative/not/absolute" }),
      })
      expect(res.status).toBe(400)
    })

    // 🔴 D4 — שכבה (ב) היא extract *ושומר-undefined*. PATCH {title} על agent
    // ready עם acpSessionId+cwd קיימים לא יכול למחוק אותם — registry.update
    // מבצע spread בלי סינון, ולכן { cwd: undefined } היה מוחק בשקט.
    it("🔴 PATCH {title} alone does not erase status/acpSessionId/cwd (D4 undefined-guard)", async () => {
      const { app, registry } = makeApp()
      const agent = await registry.create({ cliKind: "opencode", cwd: "/original" })
      await registry.update(agent.id, {
        status: "ready",
        acpSessionId: "sess-keep",
        cwd: "/original",
      })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      })
      expect(res.status).toBe(200)

      const updated = await registry.get(agent.id)
      expect(updated?.title).toBe("x")
      expect(updated?.status).toBe("ready")
      expect(updated?.acpSessionId).toBe("sess-keep")
      expect(updated?.cwd).toBe("/original")
    })

    // D7 — תופעות-projectsRegistry מותנות בנוכחות acpSessionId (עובדת-חיבור).
    // PATCH {title} בלבד לא אמור לרשום פרויקט או לדרוס lastSessionId.
    it("PATCH {title} alone does not touch projectsRegistry (D7 conditional side-effects)", async () => {
      const projectsRegistry = makeFakeProjectsRegistry()
      const { app, registry } = makeApp({ projectsRegistry })
      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      await registry.update(agent.id, { status: "ready", acpSessionId: "sess-1" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      })
      expect(res.status).toBe(200)
      expect(projectsRegistry.recordCwd).not.toHaveBeenCalled()
      expect(projectsRegistry.recordSession).not.toHaveBeenCalled()
    })

    // חלק ב של הפרוב: attach מלא עם cwd → 200, agent.cwd משתנה, ו-projectsRegistry
    // רושם תחת ה-cwd *החדש* (לא הישן) — זו שרשרת ה-cwd שכל הסלייס נבנה סביבה.
    it("full attach (acpSessionId+status+cwd) → 200, agent.cwd updated, projectsRegistry recorded under new cwd", async () => {
      const projectsRegistry = makeFakeProjectsRegistry()
      const { app, registry } = makeApp({ projectsRegistry })
      const agent = await registry.create({ cliKind: "opencode", cwd: "/tmp/probe-dirA" })

      const res = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acpSessionId: "sess-from-dirB",
          status: "ready",
          cwd: "/tmp/probe-dirB",
        }),
      })
      expect(res.status).toBe(200)

      const updated = await registry.get(agent.id)
      expect(updated?.cwd).toBe("/tmp/probe-dirB")
      expect(updated?.status).toBe("ready")
      expect(updated?.acpSessionId).toBe("sess-from-dirB")

      expect(projectsRegistry.recordCwd).toHaveBeenCalledWith("/tmp/probe-dirB", "opencode")
      expect(projectsRegistry.recordSession).toHaveBeenCalledWith(
        "/tmp/probe-dirB",
        "sess-from-dirB",
      )
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
        getRuntimeInfo: vi.fn((_id: string) => ({
          pid: 12345,
          attached: true,
          busy: false,
          lastMessageAt: null,
          lastSeenAt: null,
          via: "ws" as const,
        })),
        getConnectionCount: vi.fn(() => 1),
      }

      registerAgentsHttp(app, { registry, orchestrator, bridgeManager, env: process.env })

      const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
      const res = await app.request("/api/agents")
      expect(res.status).toBe(200)
      const body = await res.json()
      const agentData = body.agents.find((a: { id: string }) => a.id === agent.id)
      expect(agentData).toBeDefined()
      expect(agentData.pid).toBe(12345)
      expect(agentData.attached).toBe(true)
      expect(agentData.attachedVia).toBe("ws")
    })

    it("includes runtime fields with defaults when bridgeManager not provided", async () => {
      // slice ownership-truth C3: explicit 5-field mapping — bridgeManager absent → defaults.
      // Previously (spread) absent bridgeManager meant no pid/attached keys at all.
      // Now the explicit mapping always includes them with safe defaults.
      const { app, registry } = makeApp()
      await registry.create({ cliKind: "opencode", cwd: "/x" })
      const res = await app.request("/api/agents")
      const body = await res.json()
      expect(body.agents[0].pid).toBeNull()
      expect(body.agents[0].attached).toBe(false)
      expect(body.agents[0].busy).toBe(false)
      expect(body.agents[0].lastMessageAt).toBeNull()
      expect(body.agents[0].attachedVia).toBeUndefined()
    })
  })
})
