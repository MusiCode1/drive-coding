/**
 * http-scope-policy.test.ts — GET/PATCH /api/scope-policy (C2 integration).
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readAgentStore } from "../src/agents/agents-store.js"
import { createPersistentAgentRegistry } from "../src/agents/persistent-registry.js"
import { registerHttpScopePolicy } from "../src/delivery/http-scope-policy.js"
import { loadConfig } from "../src/config/load-config.js"
import { issueToken, resetAllowAlwaysGrantsForTests, SCOPE_HEADER } from "../src/agent-scope.js"
import { AGENT_ID_HEADER } from "../src/agent-identity.js"
import {
  escalationPolicyForVerb,
  getScopePolicySnapshot,
  resetScopePolicyForTests,
  setScopePolicyOverride,
} from "../src/scope-policy.js"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import { bindScopeEnforcement } from "../src/bind-scope-enforcement.js"
import { createAgentSessionRegistry } from "../src/session-host/registry.js"

const persistDirs: string[] = []

function policyApp(registry = createInMemoryAgentRegistry()) {
  const app = new Hono()
  registerHttpScopePolicy(app, { registry })
  return { app, registry }
}

describe("GET /api/scope-policy", () => {
  afterEach(() => resetScopePolicyForTests())

  it("returns ask defaults with no-store when env empty", async () => {
    const { app } = policyApp()
    const res = await app.request("/api/scope-policy")
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const body = await res.json()
    expect(body.policies).toEqual({ message: "ask", update: "ask", close: "ask" })
    expect(body.sources).toEqual({ message: "default", update: "default", close: "default" })
  })
})

describe("PATCH /api/scope-policy", () => {
  afterEach(() => resetScopePolicyForTests())

  it("rejects foreign keys and does not mutate state on 400", async () => {
    const { app } = policyApp()
    await app.request("/api/scope-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policies: { message: "allow" } }),
    })
    const before = getScopePolicySnapshot()

    const nestedForeign = await app.request("/api/scope-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policies: { message: "ask", alien: "deny" } }),
    })
    expect(nestedForeign.status).toBe(400)
    expect(getScopePolicySnapshot()).toEqual(before)

    const topForeign = await app.request("/api/scope-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policies: { message: "ask" }, extra: true }),
    })
    expect(topForeign.status).toBe(400)
    expect(getScopePolicySnapshot()).toEqual(before)
  })

  it("rejects mixed invalid enum without partial apply", async () => {
    const { app } = policyApp()
    setScopePolicyOverride({ update: "deny" })
    const before = getScopePolicySnapshot()

    const res = await app.request("/api/scope-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policies: { message: "allow", update: "ALLOW" } }),
    })
    expect(res.status).toBe(400)
    expect(getScopePolicySnapshot()).toEqual(before)
  })

  it("rejects invalid json and empty policies object", async () => {
    const { app } = policyApp()
    const badJson = await app.request("/api/scope-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{",
    })
    expect(badJson.status).toBe(400)

    const empty = await app.request("/api/scope-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policies: {} }),
    })
    expect(empty.status).toBe(400)

    const badEnum = await app.request("/api/scope-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policies: { message: "ALLOW" } }),
    })
    expect(badEnum.status).toBe(400)
  })

  it("partial patch preserves other groups and sets override source", async () => {
    const { app } = policyApp()
    const res = await app.request("/api/scope-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policies: { close: "deny" } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.policies.close).toBe("deny")
    expect(body.sources.close).toBe("override")
    expect(body.policies.message).toBe("ask")
  })

  it("PATCH close deny applies immediately to scoped DELETE", async () => {
    const registry = createInMemoryAgentRegistry()
    const app = new Hono()
    registerHttpScopePolicy(app, { registry })
    const agentSessionRegistry = createAgentSessionRegistry({
      connectionRegistry: {
        get: vi.fn(),
        getCwd: vi.fn(() => "/tmp"),
        getCliKind: vi.fn(() => "cursor"),
      } as never,
    })
    bindScopeEnforcement(app, { registry, sessionRegistry: agentSessionRegistry })

    await app.request("/api/scope-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policies: { close: "deny" } }),
    })

    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    const del = await app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })
    expect(del.status).toBe(403)
    expect(escalationPolicyForVerb("close")).toBe("deny")
  })

  it("resetScopePolicyForTests clears override back toward env/default", async () => {
    setScopePolicyOverride({ message: "allow" })
    expect(getScopePolicySnapshot().sources.message).toBe("override")
    resetScopePolicyForTests()
    expect(getScopePolicySnapshot().sources.message).toBe("default")
  })
})

describe("GET /api/scope-policy?agent=", () => {
  afterEach(() => resetScopePolicyForTests())

  it("returns effective snapshot with agent source when per-caller override set", async () => {
    const { app, registry } = policyApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp" })
    await registry.update(agent.id, { scopePolicies: { message: "allow" } })

    const res = await app.request(`/api/scope-policy?agent=${agent.id}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.policies.message).toBe("allow")
    expect(body.sources.message).toBe("agent")
    expect(body.policies.close).toBe("ask")
    expect(body.sources.close).toBe("default")
  })

  it("returns 404 for unknown agent id", async () => {
    const { app } = policyApp()
    const res = await app.request(
      "/api/scope-policy?agent=550e8400-e29b-41d4-a716-446655440000",
    )
    expect(res.status).toBe(404)
  })
})

describe("PATCH /api/scope-policy per-agent", () => {
  afterEach(() => {
    resetScopePolicyForTests()
    for (const d of persistDirs) fs.rmSync(d, { recursive: true, force: true })
    persistDirs.length = 0
  })

  it("rejects foreign keys under per-agent policies", async () => {
    const { app, registry } = policyApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp" })
    const res = await app.request("/api/scope-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: agent.id,
        policies: { message: "allow", alien: "deny" },
      }),
    })
    expect(res.status).toBe(400)
  })

  it("null clears a per-caller key back to inheritance", async () => {
    const { app, registry } = policyApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp" })
    await registry.update(agent.id, { scopePolicies: { message: "allow" } })

    const res = await app.request("/api/scope-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: agent.id, policies: { message: null } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.policies.message).toBe("ask")
    expect(body.sources.message).toBe("default")
  })

  it("persists per-agent policy across restore", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scope-policy-api-"))
    persistDirs.push(dir)
    const file = path.join(dir, "agents.json")
    const registry = createPersistentAgentRegistry({ file })
    const { app } = policyApp(registry)
    const agent = await registry.create({ cliKind: "cursor", cwd: os.tmpdir() })

    const patch = await app.request("/api/scope-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: agent.id, policies: { close: "deny" } }),
    })
    expect(patch.status).toBe(200)
    await registry.flush()

    const onDisk = readAgentStore(file)[0]
    expect(onDisk?.scopePolicies?.close).toBe("deny")

    const reloaded = createPersistentAgentRegistry({ file })
    await reloaded.restore(onDisk ? [onDisk] : [])
    const row = await reloaded.get(agent.id)
    expect(row?.scopePolicies?.close).toBe("deny")
  })
})

describe("loadConfig env layer — scope policy leaves", () => {
  it("invalid non-empty SCOPE_MESSAGE_POLICY beats file allow with ask", () => {
    const { config, envPatch } = loadConfig({
      argv: { "config-json": JSON.stringify({ scopeMessagePolicy: "allow" }) },
      env: { SCOPE_MESSAGE_POLICY: "ALLOW" },
    })
    expect(config.scopeMessagePolicy).toBe("ask")
    expect(envPatch.SCOPE_MESSAGE_POLICY).toBe("ask")
  })
})
