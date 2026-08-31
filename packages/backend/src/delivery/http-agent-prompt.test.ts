/**
 * http-agent-prompt.test.ts — surface prompt HTTP + compose wiring.
 */

import { describe, expect, it, vi } from "vitest"
import { Hono } from "hono"
import type { Agent, AgentRegistry } from "@drive-coding/core"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import { buildAgentPromptText, registerAgentPromptHttp } from "./http-agent-prompt.js"

function stubRegistry(agent: Agent | null): AgentRegistry {
  return {
    get: vi.fn(async (id: string) => (agent && agent.id === id ? agent : null)),
    list: vi.fn(async () => (agent ? [agent] : [])),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as AgentRegistry
}

const sampleAgent = {
  id: "agent-abc",
  cwd: "/tmp",
  cliKind: "cursor",
  status: "ready",
  createdAt: new Date().toISOString(),
  parentAgentId: "parent-1",
} as Agent

const urlConfig = { port: 4370, host: "127.0.0.1", publicBaseUrl: "https://public.example.com" }

describe("buildAgentPromptText", () => {
  it("includes catalog sections and agent id", () => {
    const text = buildAgentPromptText(
      {
        agentId: "agent-abc",
        parentAgentId: "parent-1",
      },
      urlConfig,
    )
    expect(text).toContain("# About drive-coding")
    expect(text).toContain("## Environment (this process)")
    expect(text).toContain("| `DRIVE_CODING_AGENT_ID` | `agent-abc` |")
    expect(text).toContain("| `DC_PARENT` | `parent-1` |")
    expect(text).toContain("| `PUBLIC_BASE_URL` | `https://public.example.com` |")
    expect(text).toContain("http://127.0.0.1:4370/api/mcp")
    expect(text).not.toMatch(/<!doctype/i)
  })
})

describe("GET /api/agent-prompt", () => {
  it("returns text/plain for a known agent", async () => {
    const app = new Hono()
    registerAgentPromptHttp(app, { registry: stubRegistry(sampleAgent), urlConfig })
    const res = await app.request("/api/agent-prompt?agent=agent-abc")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/plain/)
    const body = await res.text()
    expect(body).toContain("# About drive-coding")
    expect(body).toContain("agent-abc")
    expect(body).not.toMatch(/<!doctype/i)
  })

  it("accepts X-Drive-Coding-Agent when query missing", async () => {
    const app = new Hono()
    registerAgentPromptHttp(app, { registry: stubRegistry(sampleAgent), urlConfig })
    const res = await app.request("/api/agent-prompt", {
      headers: { [AGENT_ID_HEADER]: "agent-abc" },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("agent-abc")
  })

  it("400 when agent id missing", async () => {
    const app = new Hono()
    registerAgentPromptHttp(app, { registry: stubRegistry(null), urlConfig })
    const res = await app.request("/api/agent-prompt")
    expect(res.status).toBe(400)
  })

  it("404 for unknown agent", async () => {
    const app = new Hono()
    registerAgentPromptHttp(app, { registry: stubRegistry(sampleAgent), urlConfig })
    const res = await app.request("/api/agent-prompt?agent=nope")
    expect(res.status).toBe(404)
    expect(await res.text()).toMatch(/unknown agent/)
  })
})
