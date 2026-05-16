# Slice 2 — Implementation Brief

> **מטרה:** Dashboard + agent creation עובד. רשימת agents (in-memory), form יצירה, פרטי agent (stub — בלי spawn אמיתי).
> **תלות:** Slice 1 (✅ commit `68a2b18`).
> **המתחיל:** sub-agent בעקבות `docs/vnext-spec.md` §8.5 + ה-brief הזה.

---

## 1. החלטות שננעלו ל-Slice 2

| נושא | בחירה |
|------|--------|
| **Storage** | in-memory `Map<agentId, Agent>` בלבד. אין persistence. (D8) |
| **Identity** | אין. כל ה-agents שייכים ל-instance. (D11 [future]) |
| **Auth** | אין `Authorization` header. כל endpoint פתוח. (D11) |
| **Agent in Slice 2** | stub: `POST /api/agents` יוצר Agent עם `status: "ready"` ישר. **אין spawn אמיתי של bridge** (Slice 3). |
| **Frontend** | 3 routes: `/` (dashboard), `/agent/new` (form), `/agent/:id` (placeholder עם status). |
| **WebSocket** | לא נוסיף `/ws/agent/:id` כאן. רק `/ws/echo` נשמר מ-Slice 1. |
| **Filesystem picker** | לא בSlice 2. הuser מקליד `cwd` ידנית. (Slice עתידי) |

---

## 2. סקירת domain — מה נוסף

### 2.1 Schemas — `packages/core/src/schemas/`

חלוקת קבצים:
- `ws-messages.ts` — קיים (Slice 1)
- `agent.ts` — **חדש**: `CliKind`, `AgentStatus`, `Agent`, `AgentPublic`, `CreateAgentInput`, `AgentList`
- `index.ts` — לעדכן re-export

### 2.2 Ports — `packages/core/src/ports.ts`

**חדש**: `AgentRegistry` interface (in-memory, אין persistence).

### 2.3 Backend

**חדש**:
- `packages/backend/src/agents/registry.ts` — implements `AgentRegistry` עם `Map<string, Agent>`.
- `packages/backend/src/delivery/http-agents.ts` — 4 endpoints.
- `packages/backend/src/boot.ts` — wires registry.

### 2.4 Frontend

**חדש**:
- `packages/frontend/src/lib/api/agents.ts` — HTTP client.
- `packages/frontend/src/routes/+page.svelte` — **rewrite**: dashboard.
- `packages/frontend/src/routes/agent/new/+page.svelte` — form.
- `packages/frontend/src/routes/agent/[id]/+page.svelte` — placeholder.

---

## 3. תבניות קוד מדויקות

### 3.1 `packages/core/src/schemas/agent.ts`

```typescript
import { type } from "arktype"

// CLI kinds נתמכים (D6 + D24)
export const CliKind = type("'opencode' | 'claude' | 'gemini' | 'codex'")
export type CliKind = typeof CliKind.infer

// Status state machine
// starting: בתהליך spawn (Slice 3+)
// ready: זמין לקבל prompts
// busy: prompt בעבודה
// crashed: bridge נפל
// closed: כובה ע"י user
export const AgentStatus = type(
  "'starting' | 'ready' | 'busy' | 'crashed' | 'closed'"
)
export type AgentStatus = typeof AgentStatus.infer

// Internal — backend בלבד
export const Agent = type({
  id: "string.uuid",
  cliKind: CliKind,
  cwd: "string",
  modelOverride: "string | null",
  status: AgentStatus,
  createdAt: "string.date.iso",
  // Bridge details (יתמלאו ב-Slice 3)
  "bridgePort?": "number",
  "acpSessionId?": "string",
})
export type Agent = typeof Agent.infer

// Public — מה שה-frontend מקבל
export const AgentPublic = type({
  id: "string.uuid",
  cliKind: CliKind,
  cwd: "string",
  modelOverride: "string | null",
  status: AgentStatus,
  createdAt: "string.date.iso",
})
export type AgentPublic = typeof AgentPublic.infer

// Input ל-POST /api/agents
export const CreateAgentInput = type({
  cliKind: CliKind,
  cwd: "string >= 1",
  "modelOverride?": "string | null",
})
export type CreateAgentInput = typeof CreateAgentInput.infer

// רשימה
export const AgentList = type({
  agents: AgentPublic.array(),
})
export type AgentList = typeof AgentList.infer

// Helper — Agent → AgentPublic
export function toAgentPublic(agent: Agent): AgentPublic {
  return {
    id: agent.id,
    cliKind: agent.cliKind,
    cwd: agent.cwd,
    modelOverride: agent.modelOverride,
    status: agent.status,
    createdAt: agent.createdAt,
  }
}
```

### 3.2 `packages/core/src/schemas/index.ts` (לעדכון)

```typescript
export * from "./ws-messages"
export * from "./agent"
```

### 3.3 `packages/core/src/ports.ts` (חדש)

```typescript
import type { Agent, CreateAgentInput, AgentStatus } from "./schemas"

/**
 * AgentRegistry — abstract storage לcollection של agents.
 * Slice 2: in-memory Map.
 * Slice 3+: יוסיף קישור ל-BridgeHandle.
 * [future]: אם נוסיף identity, נוסיף ownerId.
 */
export interface AgentRegistry {
  /** יוצר agent חדש. ב-Slice 2 stub status='ready' ישר. */
  create(input: CreateAgentInput): Promise<Agent>

  /** מחזיר agent לפי id, או null אם לא קיים. */
  get(id: string): Promise<Agent | null>

  /** רשימת כל ה-agents (no filter — אין identity ב-MVP). */
  list(): Promise<ReadonlyArray<Agent>>

  /** עדכון status / bridge details. throw אם id לא קיים. */
  update(id: string, patch: Partial<Pick<Agent, "status" | "bridgePort" | "acpSessionId">>): Promise<Agent>

  /** הסרה. throw אם לא קיים. */
  delete(id: string): Promise<void>
}
```

### 3.4 `packages/core/src/index.ts` (לעדכון)

```typescript
export * from "./schemas"
export type * from "./ports"
```

### 3.5 `packages/core/tests/agent-schema.test.ts` (TDD)

```typescript
import { describe, it, expect } from "vitest"
import { Agent, AgentPublic, CreateAgentInput, toAgentPublic, type } from "../src"
// (אם `type` לא re-exported מ-core, יבוא ישיר מ-arktype)

describe("CreateAgentInput", () => {
  it("accepts valid input", () => {
    const result = CreateAgentInput({
      cliKind: "opencode",
      cwd: "/home/user/foo",
    })
    expect(result).toMatchObject({ cliKind: "opencode", cwd: "/home/user/foo" })
  })

  it("rejects empty cwd", () => {
    const result = CreateAgentInput({ cliKind: "opencode", cwd: "" })
    expect(result).toHaveProperty("summary")
  })

  it("rejects invalid cliKind", () => {
    const result = CreateAgentInput({ cliKind: "vim", cwd: "/foo" } as any)
    expect(result).toHaveProperty("summary")
  })

  it("modelOverride optional", () => {
    const result = CreateAgentInput({ cliKind: "claude", cwd: "/x" })
    expect(result).not.toHaveProperty("summary")
  })
})

describe("toAgentPublic", () => {
  it("strips bridge fields", () => {
    const agent = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      cliKind: "opencode" as const,
      cwd: "/foo",
      modelOverride: null,
      status: "ready" as const,
      createdAt: "2026-05-16T05:00:00.000Z",
      bridgePort: 7100,
      acpSessionId: "sess_abc",
    }
    const pub = toAgentPublic(agent)
    expect(pub).not.toHaveProperty("bridgePort")
    expect(pub).not.toHaveProperty("acpSessionId")
    expect(pub).toMatchObject({
      id: agent.id,
      cliKind: "opencode",
      status: "ready",
    })
  })
})
```

### 3.6 `packages/backend/src/agents/registry.ts` (in-memory)

```typescript
import { randomUUID } from "node:crypto"
import type { AgentRegistry } from "@drive-coding/core"
import type { Agent, CreateAgentInput } from "@drive-coding/core"

/**
 * In-memory AgentRegistry.
 * נאבד ב-restart (D8 — acceptable ל-MVP).
 * Thread-safe? Bun + Node single-threaded JS — yes.
 */
export function createInMemoryAgentRegistry(): AgentRegistry {
  const store = new Map<string, Agent>()

  return {
    async create(input: CreateAgentInput): Promise<Agent> {
      const id = randomUUID()
      const agent: Agent = {
        id,
        cliKind: input.cliKind,
        cwd: input.cwd,
        modelOverride: input.modelOverride ?? null,
        status: "ready", // Slice 2 stub. Slice 3+: starting → ready
        createdAt: new Date().toISOString(),
      }
      store.set(id, agent)
      return agent
    },

    async get(id: string): Promise<Agent | null> {
      return store.get(id) ?? null
    },

    async list(): Promise<ReadonlyArray<Agent>> {
      return [...store.values()]
    },

    async update(id, patch): Promise<Agent> {
      const existing = store.get(id)
      if (!existing) throw new Error(`Agent ${id} not found`)
      const updated: Agent = { ...existing, ...patch }
      store.set(id, updated)
      return updated
    },

    async delete(id: string): Promise<void> {
      if (!store.has(id)) throw new Error(`Agent ${id} not found`)
      store.delete(id)
    },
  }
}
```

### 3.7 `packages/backend/tests/registry.test.ts` (TDD)

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import type { AgentRegistry } from "@drive-coding/core"
import { createInMemoryAgentRegistry } from "../src/agents/registry"

describe("InMemoryAgentRegistry", () => {
  let registry: AgentRegistry

  beforeEach(() => {
    registry = createInMemoryAgentRegistry()
  })

  it("creates agent with status=ready (Slice 2 stub)", async () => {
    const agent = await registry.create({ cliKind: "opencode", cwd: "/foo" })
    expect(agent.status).toBe("ready")
    expect(agent.cliKind).toBe("opencode")
    expect(agent.cwd).toBe("/foo")
    expect(agent.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(agent.modelOverride).toBeNull()
  })

  it("retrieves created agent", async () => {
    const created = await registry.create({ cliKind: "claude", cwd: "/x" })
    const fetched = await registry.get(created.id)
    expect(fetched).toEqual(created)
  })

  it("returns null for unknown id", async () => {
    expect(await registry.get("00000000-0000-0000-0000-000000000000")).toBeNull()
  })

  it("lists all agents", async () => {
    await registry.create({ cliKind: "opencode", cwd: "/a" })
    await registry.create({ cliKind: "gemini", cwd: "/b" })
    const list = await registry.list()
    expect(list).toHaveLength(2)
  })

  it("updates status", async () => {
    const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
    const updated = await registry.update(agent.id, { status: "busy" })
    expect(updated.status).toBe("busy")
    expect((await registry.get(agent.id))?.status).toBe("busy")
  })

  it("throws on update of unknown id", async () => {
    await expect(registry.update("invalid-id", { status: "busy" })).rejects.toThrow()
  })

  it("deletes agent", async () => {
    const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
    await registry.delete(agent.id)
    expect(await registry.get(agent.id)).toBeNull()
  })

  it("throws on delete of unknown id", async () => {
    await expect(registry.delete("invalid-id")).rejects.toThrow()
  })
})
```

### 3.8 `packages/backend/src/delivery/http-agents.ts` (חדש)

```typescript
import type { Hono } from "hono"
import { type } from "arktype"
import {
  CreateAgentInput,
  toAgentPublic,
  type AgentRegistry,
} from "@drive-coding/core"

export function registerAgentsHttp(app: Hono, deps: { registry: AgentRegistry }): void {
  // GET /api/agents — רשימה
  app.get("/api/agents", async (c) => {
    const all = await deps.registry.list()
    return c.json({ agents: all.map(toAgentPublic) })
  })

  // POST /api/agents — יצירה
  app.post("/api/agents", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }

    const parsed = CreateAgentInput(body)
    if (parsed instanceof type.errors) {
      return c.json({ error: parsed.summary }, 400)
    }

    const agent = await deps.registry.create(parsed)
    return c.json({ agent: toAgentPublic(agent) }, 201)
  })

  // GET /api/agents/:id — פרטי agent
  app.get("/api/agents/:id", async (c) => {
    const id = c.req.param("id")
    const agent = await deps.registry.get(id)
    if (!agent) return c.json({ error: "agent not found" }, 404)
    return c.json({ agent: toAgentPublic(agent) })
  })

  // DELETE /api/agents/:id — מחיקה
  app.delete("/api/agents/:id", async (c) => {
    const id = c.req.param("id")
    try {
      await deps.registry.delete(id)
      return c.body(null, 204)
    } catch {
      return c.json({ error: "agent not found" }, 404)
    }
  })
}
```

### 3.9 `packages/backend/tests/http-agents.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { Hono } from "hono"
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
```

### 3.10 `packages/backend/src/server.ts` (לעדכון — wire registry + endpoints)

```typescript
import { Hono } from "hono"
import { cors } from "hono/cors"
import { createInMemoryAgentRegistry } from "./agents/registry"
import { registerHttp } from "./delivery/http"
import { registerAgentsHttp } from "./delivery/http-agents"
import { registerEchoWs } from "./delivery/ws-echo"

const app = new Hono()
app.use("*", cors({ origin: ["http://localhost:5173"], credentials: true }))

// Boot dependencies
const registry = createInMemoryAgentRegistry()

// HTTP routes
registerHttp(app)
registerAgentsHttp(app, { registry })

// WS routes
const echo = registerEchoWs(app)

const port = Number(process.env.PORT ?? 4000)

Bun.serve({
  port,
  fetch: (req, server) => {
    const url = new URL(req.url)
    if (url.pathname === "/ws/echo") {
      const upgraded = server.upgrade(req)
      if (upgraded) return
      return new Response("WS upgrade failed", { status: 426 })
    }
    return app.fetch(req)
  },
  websocket: echo.websocket,
})

console.log(`[backend] listening on http://localhost:${port}`)
```

### 3.11 `packages/frontend/src/lib/api/agents.ts`

```typescript
import type { AgentPublic, CreateAgentInput, AgentList } from "@drive-coding/core"

const API_BASE = ""  // proxy via vite (D45 frontend dev)

export async function listAgents(): Promise<AgentList> {
  const res = await fetch(`${API_BASE}/api/agents`)
  if (!res.ok) throw new Error(`listAgents failed: ${res.status}`)
  return res.json()
}

export async function createAgent(input: CreateAgentInput): Promise<{ agent: AgentPublic }> {
  const res = await fetch(`${API_BASE}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `createAgent failed: ${res.status}`)
  }
  return res.json()
}

export async function getAgent(id: string): Promise<{ agent: AgentPublic }> {
  const res = await fetch(`${API_BASE}/api/agents/${id}`)
  if (!res.ok) throw new Error(`getAgent failed: ${res.status}`)
  return res.json()
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agents/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`deleteAgent failed: ${res.status}`)
}
```

### 3.12 `packages/frontend/src/routes/+page.svelte` (rewrite — dashboard)

```svelte
<script lang="ts">
  import { onMount } from "svelte"
  import type { AgentPublic } from "@drive-coding/core"
  import { listAgents, deleteAgent } from "$lib/api/agents"

  let agents = $state<AgentPublic[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)

  async function load(): Promise<void> {
    loading = true
    error = null
    try {
      const { agents: list } = await listAgents()
      agents = [...list].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      )
    } catch (e) {
      error = e instanceof Error ? e.message : "טעינה נכשלה"
    } finally {
      loading = false
    }
  }

  async function remove(id: string): Promise<void> {
    if (!confirm("למחוק את הסוכן?")) return
    try {
      await deleteAgent(id)
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : "מחיקה נכשלה"
    }
  }

  onMount(load)
</script>

<main>
  <header>
    <h1>drive-coding</h1>
    <a href="/agent/new" class="primary">+ סוכן חדש</a>
  </header>

  {#if loading}
    <p>טוען...</p>
  {:else if error}
    <p class="error">שגיאה: {error}</p>
  {:else if agents.length === 0}
    <p class="empty">אין סוכנים. לחץ "+ סוכן חדש" כדי להתחיל.</p>
  {:else}
    <ul class="cards">
      {#each agents as agent (agent.id)}
        <li class="card">
          <a href={`/agent/${agent.id}`}>
            <div class="card-title">{agent.cliKind}</div>
            <div class="card-cwd"><code>{agent.cwd}</code></div>
            <div class="card-status status-{agent.status}">{agent.status}</div>
          </a>
          <button class="delete" onclick={() => remove(agent.id)} aria-label="מחק">×</button>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  main { max-width: 720px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
  h1 { margin: 0; }
  .primary { background: #2563eb; color: white; padding: 0.6rem 1.2rem; border-radius: 8px; text-decoration: none; font-weight: 600; }
  .primary:hover { background: #1d4ed8; }
  .empty { color: #666; text-align: center; padding: 3rem 0; }
  .error { color: #b91c1c; background: #fef2f2; padding: 0.75rem; border-radius: 6px; }
  .cards { list-style: none; padding: 0; display: grid; gap: 1rem; }
  .card { position: relative; background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.2rem; transition: box-shadow 0.15s; }
  .card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .card a { display: block; text-decoration: none; color: inherit; }
  .card-title { font-size: 1.2rem; font-weight: 600; margin-bottom: 0.25rem; }
  .card-cwd { color: #6b7280; font-size: 0.9rem; margin-bottom: 0.5rem; }
  .card-status { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.8rem; font-weight: 500; }
  .status-ready { background: #d1fae5; color: #065f46; }
  .status-busy { background: #fef3c7; color: #92400e; }
  .status-starting { background: #dbeafe; color: #1e40af; }
  .status-crashed { background: #fee2e2; color: #991b1b; }
  .status-closed { background: #f3f4f6; color: #4b5563; }
  .delete { position: absolute; top: 0.8rem; left: 0.8rem; background: transparent; border: none; font-size: 1.5rem; color: #9ca3af; cursor: pointer; padding: 0.2rem 0.5rem; line-height: 1; }
  .delete:hover { color: #dc2626; }
</style>
```

### 3.13 `packages/frontend/src/routes/agent/new/+page.svelte`

```svelte
<script lang="ts">
  import { goto } from "$app/navigation"
  import { type } from "arktype"
  import { CliKind, CreateAgentInput } from "@drive-coding/core"
  import { createAgent } from "$lib/api/agents"

  let cliKind = $state<typeof CliKind.infer>("opencode")
  let cwd = $state("")
  let modelOverride = $state("")
  let submitting = $state(false)
  let error = $state<string | null>(null)

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault()
    error = null

    const input = {
      cliKind,
      cwd: cwd.trim(),
      modelOverride: modelOverride.trim() || null,
    }
    const parsed = CreateAgentInput(input)
    if (parsed instanceof type.errors) {
      error = parsed.summary
      return
    }

    submitting = true
    try {
      const { agent } = await createAgent(parsed)
      await goto(`/agent/${agent.id}`)
    } catch (e) {
      error = e instanceof Error ? e.message : "יצירה נכשלה"
    } finally {
      submitting = false
    }
  }
</script>

<main>
  <header>
    <a href="/" class="back">← חזרה</a>
    <h1>סוכן חדש</h1>
  </header>

  <form onsubmit={submit}>
    <label>
      <span>CLI</span>
      <select bind:value={cliKind} required>
        <option value="opencode">opencode</option>
        <option value="claude">Claude Code</option>
        <option value="gemini">Gemini CLI</option>
        <option value="codex">Codex</option>
      </select>
    </label>

    <label>
      <span>תיקיית עבודה (cwd)</span>
      <input
        type="text"
        bind:value={cwd}
        placeholder="/home/user/projects/foo"
        dir="ltr"
        required
      />
    </label>

    <label>
      <span>Model override (אופציונלי)</span>
      <input
        type="text"
        bind:value={modelOverride}
        placeholder="claude-sonnet-4 / gpt-5 / ..."
        dir="ltr"
      />
    </label>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <button type="submit" disabled={submitting} class="primary">
      {submitting ? "יוצר..." : "צור"}
    </button>
  </form>
</main>

<style>
  main { max-width: 480px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; }
  header { display: flex; gap: 1rem; align-items: center; margin-bottom: 1.5rem; }
  h1 { margin: 0; }
  .back { color: #6b7280; text-decoration: none; }
  .back:hover { color: #111827; }
  form { display: flex; flex-direction: column; gap: 1rem; }
  label { display: flex; flex-direction: column; gap: 0.3rem; }
  label > span { font-weight: 500; font-size: 0.9rem; }
  input, select { padding: 0.6rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem; font-family: inherit; }
  input:focus, select:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1); }
  .primary { background: #2563eb; color: white; padding: 0.7rem; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 0.5rem; }
  .primary:hover:not(:disabled) { background: #1d4ed8; }
  .primary:disabled { background: #9ca3af; cursor: wait; }
  .error { color: #b91c1c; background: #fef2f2; padding: 0.75rem; border-radius: 6px; margin: 0; font-size: 0.9rem; white-space: pre-wrap; }
</style>
```

### 3.14 `packages/frontend/src/routes/agent/[id]/+page.svelte` (placeholder)

```svelte
<script lang="ts">
  import { page } from "$app/state"
  import { onMount } from "svelte"
  import type { AgentPublic } from "@drive-coding/core"
  import { getAgent } from "$lib/api/agents"

  let agentId = $derived(page.params.id)
  let agent = $state<AgentPublic | null>(null)
  let error = $state<string | null>(null)
  let loading = $state(true)

  async function load(): Promise<void> {
    loading = true
    error = null
    try {
      const { agent: fetched } = await getAgent(agentId)
      agent = fetched
    } catch (e) {
      error = e instanceof Error ? e.message : "טעינה נכשלה"
    } finally {
      loading = false
    }
  }

  $effect(() => {
    if (agentId) load()
  })
</script>

<main>
  <header>
    <a href="/" class="back">← Dashboard</a>
  </header>

  {#if loading}
    <p>טוען...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if agent}
    <h1>{agent.cliKind}</h1>
    <dl>
      <dt>cwd</dt><dd><code>{agent.cwd}</code></dd>
      <dt>status</dt><dd>{agent.status}</dd>
      <dt>נוצר</dt><dd>{new Date(agent.createdAt).toLocaleString("he-IL")}</dd>
      {#if agent.modelOverride}
        <dt>model</dt><dd>{agent.modelOverride}</dd>
      {/if}
    </dl>
    <p class="placeholder">
      ממשק קולי יתווסף ב-Slice 4. כרגע סוכן זה הוא רק entry ב-registry.
    </p>
  {/if}
</main>

<style>
  main { max-width: 720px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; }
  header { margin-bottom: 1rem; }
  .back { color: #6b7280; text-decoration: none; }
  .back:hover { color: #111827; }
  h1 { margin: 0 0 1.5rem; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.5rem 1rem; margin-bottom: 2rem; }
  dt { font-weight: 600; color: #6b7280; }
  dd { margin: 0; }
  code { background: #f3f4f6; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
  .placeholder { color: #9ca3af; font-style: italic; padding: 1rem; background: #f9fafb; border-radius: 8px; }
  .error { color: #b91c1c; background: #fef2f2; padding: 0.75rem; border-radius: 6px; }
</style>
```

---

## 4. Step-by-step

1. `cd /home/user/projects/voice-acp-v2` (worktree קיים)
2. **TDD חלק א' — schemas:**
   - צור `packages/core/src/schemas/agent.ts` (§3.1)
   - עדכן `packages/core/src/schemas/index.ts` (§3.2)
   - צור `packages/core/tests/agent-schema.test.ts` (§3.5)
   - `pnpm test` → 4+ בדיקות חדשות עוברות
3. **TDD חלק ב' — ports:**
   - צור `packages/core/src/ports.ts` (§3.3)
   - עדכן `packages/core/src/index.ts` (§3.4)
   - `pnpm typecheck` עובר
4. **TDD חלק ג' — registry:**
   - צור `packages/backend/src/agents/registry.ts` (§3.6)
   - צור `packages/backend/tests/registry.test.ts` (§3.7) — 8 בדיקות
   - `pnpm test` עובר
5. **HTTP endpoints:**
   - צור `packages/backend/src/delivery/http-agents.ts` (§3.8)
   - צור `packages/backend/tests/http-agents.test.ts` (§3.9)
   - עדכן `packages/backend/src/server.ts` (§3.10)
   - `pnpm test` + `pnpm typecheck` עוברים
   - תיקון נדרש: ייתכן ש-`@drive-coding/core` לא מייצא `type` מ-arktype — יבא ישירות מ-`arktype` ב-tests/clients
6. **Frontend API client:**
   - צור `packages/frontend/src/lib/api/agents.ts` (§3.11)
7. **Frontend routes:**
   - השכל `packages/frontend/src/routes/+page.svelte` (§3.12)
   - צור `packages/frontend/src/routes/agent/new/+page.svelte` (§3.13)
   - צור `packages/frontend/src/routes/agent/[id]/+page.svelte` (§3.14)
   - `pnpm typecheck` ב-frontend עובר
8. **בדיקה ידנית (smoke):**
   - הפעל backend: `cd packages/backend && bun --watch src/server.ts`
   - הפעל frontend: `cd packages/frontend && pnpm dev`
   - `curl http://localhost:4000/api/agents` → `{"agents":[]}`
   - `curl -X POST http://localhost:4000/api/agents -H "Content-Type: application/json" -d '{"cliKind":"opencode","cwd":"/tmp"}'` → 201 + agent
   - `curl http://localhost:4000/api/agents` → רשימה עם agent חדש
9. **Lint + commit:**
   - `pnpm lint` (Biome) — תקן אם יש
   - `pnpm test` כל ה-test suites עוברים
   - `git add . && git commit -m "(slice-2): dashboard + agent stub registry"` עם הודעה מפורטת

---

## 5. Definition of Done

- [ ] `packages/core/src/schemas/agent.ts` קיים עם ArkType types
- [ ] `packages/core/src/ports.ts` קיים עם `AgentRegistry`
- [ ] `packages/backend/src/agents/registry.ts` עם `createInMemoryAgentRegistry`
- [ ] 4 HTTP endpoints עובדים: `GET/POST /api/agents`, `GET/DELETE /api/agents/:id`
- [ ] 3 frontend routes: `/`, `/agent/new`, `/agent/:id`
- [ ] `pnpm typecheck` נקי בשלושה packages
- [ ] `pnpm test` נקי (לפחות 4 schemas + 8 registry + 8 http = 20+ tests חדשות)
- [ ] `pnpm lint` נקי
- [ ] backend מאזין על port 4000, frontend על 5173
- [ ] curl smoke test על 4 ה-endpoints עובד
- [ ] commit עם הודעה מפורטת + סטיות מ-brief מתועדות

---

## 6. מה Slice 2 לא כולל

- **Spawn אמיתי של bridge** — Slice 3. כל agent ב-Slice 2 הוא stub עם `status: ready` ישר.
- **WebSocket `/ws/agent/:id`** — Slice 4.
- **Voice anything** — Slice 5.
- **Identity / Auth / tokens** — אין ב-MVP (D11).
- **Persistence** — אין ב-MVP (D8). agents נאבדים ב-restart.
- **Filesystem cwd picker** — user מקליד path ידנית.

---

## 7. דיווח לסיום

החזר ל-Tama:
1. commit hash
2. DoD checklist (כל פריטי §5)
3. סטיות מ-brief + פתרונות
4. תוצאות `curl` ל-4 endpoints
5. שאלות / observations לקראת Slice 3

**זמן צפוי:** 30-45 דקות.
