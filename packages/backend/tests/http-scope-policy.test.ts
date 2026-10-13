/**
 * http-scope-policy.test.ts — GET/PATCH /api/scope-policy (C2 integration).
 */

import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
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

function policyApp() {
  const app = new Hono()
  registerHttpScopePolicy(app)
  return app
}

describe("GET /api/scope-policy", () => {
  afterEach(() => resetScopePolicyForTests())

  it("returns ask defaults with no-store when env empty", async () => {
    const app = policyApp()
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

  it("rejects invalid json and empty policies object", async () => {
    const app = policyApp()
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
    const app = policyApp()
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
    const app = new Hono()
    registerHttpScopePolicy(app)
    const registry = createInMemoryAgentRegistry()
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
