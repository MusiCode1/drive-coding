import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AGENT_ID_HEADER } from "../src/agent-identity.js"
import {
  issueToken,
  recordAllowAlwaysGrant,
  resetAllowAlwaysGrantsForTests,
  SCOPE_HEADER,
} from "../src/agent-scope.js"
import { closeAllAgents } from "../src/app/close-all-agents.js"
import { buildApp } from "../src/boot/app.js"
import { type BootDeps, createDeps, type Disposable } from "../src/boot/deps.js"
import { createWsStack } from "../src/boot/ws.js"
import { resetScopePolicyForTests, setScopePolicyOverride } from "../src/scope-policy.js"

let stateDir: string

vi.mock("../src/paths.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/paths.js")>()),
  ensureStateSubdir: (...segments: string[]) => {
    const path = join(stateDir, ...segments)
    mkdirSync(path, { recursive: true })
    return path
  },
}))

vi.mock("@drive-coding/provider/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@drive-coding/provider/config")>()),
  onConfigChange: vi.fn(),
}))

const decisions = {
  "POST /api/agents": "exempt",
  "DELETE /api/agents": "subtree",
  "DELETE /api/agents/:id": "scoped",
  "DELETE /api/agents/:id/connection": "scoped",
  "PATCH /api/agents/:id": "scoped",
  "POST /api/agents/:id/presence": "exempt",
  "POST /api/agents/:id/reply": "scoped",
  "POST /api/agents/:id/rpc": "scoped",
  "POST /api/agents/:id/subscribe": "scoped",
} as const

function assertCoverage(app: Hono) {
  const methods = new Set(["POST", "PUT", "PATCH", "DELETE"])
  const routes = new Set(
    app.routes
      .filter(
        ({ method, path }) =>
          methods.has(method) && (path === "/api/agents" || path.startsWith("/api/agents/")),
      )
      .map(({ method, path }) => `${method} ${path}`),
  )
  const unlisted = [...routes].filter((route) => !Object.hasOwn(decisions, route))
  expect(unlisted, `Missing scope decisions: ${unlisted.join(", ")}`).toEqual([])
  expect([...routes].sort()).toEqual(Object.keys(decisions).sort())
}

describe("scope decisions on the production agent write routes", () => {
  let app: Hono
  let deps: BootDeps
  let disposables: Disposable[]
  let caller: string
  let child: string
  let foreign: string

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "dc-write-routes-"))
    disposables = []
    const config = {
      agentsStoreFile: join(stateDir, "agents.json"),
      historyDbFile: join(stateDir, "history.sqlite"),
    }
    app = new Hono()
    ;({ deps, disposables } = await createDeps(config, {}, app))
    const ws = createWsStack()
    vi.spyOn(deps.orchestrator, "deleteAndKill").mockImplementation(async (id) => {
      await deps.registry.delete(id)
    })
    vi.spyOn(deps.orchestrator, "deleteAllAndKill").mockImplementation(() =>
      closeAllAgents(() => deps.registry.list(), deps.orchestrator.deleteAndKill),
    )
    await buildApp(app, config, deps, { broadcastConfigChanged: ws.broadcastConfigChanged })
    ws.wireRoutes(app, deps)
    caller = (await deps.registry.create({ cwd: stateDir, cliKind: "claude" })).id
    child = (
      await deps.registry.create({
        cwd: stateDir,
        cliKind: "claude",
        parentAgentId: caller,
      })
    ).id
    foreign = (await deps.registry.create({ cwd: stateDir, cliKind: "claude" })).id
    setScopePolicyOverride({ message: "deny", update: "deny", close: "deny" })
  })

  afterEach(async () => {
    for (const disposable of disposables) await disposable.dispose({ sig: "SIGTERM" })
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetScopePolicyForTests()
    resetAllowAlwaysGrantsForTests()
    rmSync(stateDir, { recursive: true, force: true })
  })

  function request(method: string, path: string, token?: string, body?: unknown) {
    const headers = new Headers({ "Content-Type": "application/json" })
    if (token !== undefined) headers.set(SCOPE_HEADER, token)
    return app.request(path, { method, headers, body: JSON.stringify(body) })
  }

  it("requires a decision for each registered route and rejects an unlisted route", () => {
    assertCoverage(app)
    app.post("/api/agents/synthetic", (c) => c.body(null, 204))
    expect(() => assertCoverage(app)).toThrow("POST /api/agents/synthetic")
  })

  it.each([
    { method: "DELETE", suffix: "", status: 204 },
    { method: "DELETE", suffix: "/connection", status: 404 },
    { method: "PATCH", suffix: "", status: 200, body: { title: "updated" } },
    {
      method: "POST",
      suffix: "/reply",
      status: 404,
      body: { kind: "permission", requestId: 1, result: {} },
    },
    {
      method: "POST",
      suffix: "/rpc",
      status: 404,
      body: { method: "session/cancel", params: { sessionId: "test" } },
    },
  ])(
    "enforces the scope decision for $method :id$suffix",
    async ({ method, suffix, status, body }) => {
      const path = `/api/agents/${foreign}${suffix}`
      const denied = await request(method, path, issueToken(caller), body)
      expect(denied.status).toBe(403)
      expect(await denied.json()).toMatchObject({ error: "scope-denied" })
      const allowed = await request(method, path, issueToken(foreign), body)
      expect(allowed.status).toBe(status)
    },
  )

  it("checks the subscriber while the watched agent stays outside the subtree", async () => {
    const path = `/api/agents/${foreign}/subscribe`
    const denied = await request("POST", path, issueToken(caller), { subscriberAgentId: foreign })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error: "scope-denied" })
    const allowed = await request("POST", path, issueToken(caller), { subscriberAgentId: caller })
    expect(allowed.status).toBe(204)
    const unscoped = await request("POST", path, undefined, { subscriberAgentId: foreign })
    expect(unscoped.status).toBe(204)
  })

  it.each([false, true])("guard and grant for subscriptions (MCP=%s)", async (mcp) => {
    const otherWatched = await deps.registry.create({ cwd: stateDir, cliKind: "claude" })
    const token = issueToken(caller)
    const client = new Client({ name: "scope-subscriptions", version: "1.0.0" })
    async function subscribe(watched: string, subscriber?: string) {
      if (mcp) {
        const result = await client.callTool({
          name: "session_subscribe",
          arguments: { agent: watched, subscriber },
        })
        if (result.isError) expect(JSON.stringify(result)).toContain("scope-denied")
        return !result.isError
      }
      const res = await request("POST", `/api/agents/${watched}/subscribe`, token, {
        subscriberAgentId: subscriber,
      })
      if (res.status === 403) expect(await res.json()).toMatchObject({ error: "scope-denied" })
      return res.status === 204
    }

    try {
      if (mcp) {
        await client.connect(
          new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
            fetch: (input, init) => Promise.resolve(app.request(new Request(input, init))),
            requestInit: { headers: { [SCOPE_HEADER]: token, [AGENT_ID_HEADER]: caller } },
          }),
        )
        expect(await subscribe(foreign)).toBe(true)
      }
      expect(await subscribe(foreign, caller)).toBe(true)
      recordAllowAlwaysGrant(caller, foreign, "send")
      expect(await subscribe(foreign, foreign)).toBe(false)
      recordAllowAlwaysGrant(caller, foreign, "subscribe")
      expect(await subscribe(foreign, foreign)).toBe(true)
      expect(await subscribe(otherWatched.id, foreign)).toBe(true)
      expect(await subscribe(foreign, otherWatched.id)).toBe(false)
      expect(deps.agentEventBus.subscribersOf(otherWatched.id)).toEqual([foreign])
    } finally {
      await client.close()
    }
  })

  it("bulk close preserves the foreign agent and lists it as skipped", async () => {
    const response = await request("DELETE", "/api/agents", issueToken(caller))
    expect(response.status).toBe(200)
    expect(await deps.registry.get(foreign)).not.toBeNull()
    expect(await response.json()).toEqual({
      closed: [caller, child],
      failed: [],
      skipped: [{ id: foreign, reason: "scope" }],
    })
    expect(await deps.registry.list()).toMatchObject([{ id: foreign }])
  })

  it.each([undefined, "synthetic-master"])(
    "retains the unscoped bulk shape (%s)",
    async (token) => {
      vi.stubEnv("DC_MASTER_KEY", "synthetic-master")
      const response = await request("DELETE", "/api/agents", token)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ closed: [caller, child, foreign], failed: [] })
    },
  )

  it("rejects invalid bulk tokens without closing any agent", async () => {
    const response = await request("DELETE", "/api/agents", "invalid")
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: "scope-denied" })
    expect(await deps.registry.list()).toHaveLength(3)
  })
})
