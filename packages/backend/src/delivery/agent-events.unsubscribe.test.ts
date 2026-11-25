import { setImmediate } from "node:timers/promises"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import {
  issueToken,
  recordAllowAlwaysGrant,
  recordReplyGrant,
  resetAllowAlwaysGrantsForTests,
  SCOPE_HEADER,
} from "../agent-scope.js"
import { createInMemoryAgentRegistry } from "../agents/registry.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import { resetScopePolicyForTests, setScopePolicyOverride } from "../scope-policy.js"
import { createAgentEventBus } from "../session-host/agent-events.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import type { ExtendedSessionHost } from "../session-host/session-host.js"
import { wireAgentEventDelivery } from "./agent-events-deliver.js"
import { registerAgentEventsHttp } from "./agent-events-http.js"
import { registerMcpHttp } from "./http-mcp.js"

type Transport = "http" | "mcp"
type Operation = "subscribe" | "unsubscribe"

async function fixture() {
  const app = new Hono()
  const registry = createInMemoryAgentRegistry()
  const eventBus = createAgentEventBus()
  const makeAgent = async () => (await registry.create({ cwd: "/fixture", cliKind: "claude" })).id
  const [a, b, c, otherWatched, foreign] = await Promise.all([
    makeAgent(),
    makeAgent(),
    makeAgent(),
    makeAgent(),
    makeAgent(),
  ])

  const promptA = vi.fn(async (_sessionId: string, _prompt: string) => {})
  const promptC = vi.fn(async (_sessionId: string, _prompt: string) => {})
  const subscriberHosts = new Map([
    [a, { state: { sessionId: "sub-a" }, prompt: promptA }],
    [c, { state: { sessionId: "sub-c" }, prompt: promptC }],
  ])
  const watchedHost = {
    state: { messages: [{ role: "assistant", segments: [{ text: "quoted-reply" }] }] },
    emitExtNotification: vi.fn(),
  } as unknown as ExtendedSessionHost
  const getHost = vi.fn((id: string) => (id === b ? watchedHost : undefined))
  const getOrCreateHost = vi.fn(async (id: string) => {
    const host = subscriberHosts.get(id)
    return host ? { ok: true, entry: { host } } : { ok: false, reason: "agent not found" }
  })
  const agentSessionRegistry = { getHost, getOrCreateHost } as unknown as AgentSessionRegistry
  const deps = { registry, eventBus, agentSessionRegistry }
  registerAgentEventsHttp(app, deps)
  registerMcpHttp(app, {
    ...deps,
    orchestrator: {} as AgentOrchestrator,
    env: {},
    urlConfig: { port: 4000, host: "127.0.0.1" },
  })
  wireAgentEventDelivery({ eventBus, agentSessionRegistry })

  async function connect(headers?: Record<string, string>) {
    const client = new Client({ name: "agent-event-contract", version: "1.0.0" })
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://mcp.test/api/mcp"), {
        fetch: (input, init) => Promise.resolve(app.request(new Request(input, init))),
        requestInit: { headers },
      }),
    )
    clients.push(client)
    return client
  }

  function request(method: string, watched: string, json: string, token?: string) {
    const headers = new Headers({ "Content-Type": "application/json" })
    if (token !== undefined) headers.set(SCOPE_HEADER, token)
    return app.request(`/api/agents/${watched}/subscribe`, { method, headers, body: json })
  }

  async function change(
    transport: Transport,
    operation: Operation,
    watched: string,
    subscriber?: string,
    opts?: { client?: Client; token?: string; includeLastAssistantText?: boolean },
  ) {
    const extra = opts?.includeLastAssistantText ? { includeLastAssistantText: true } : {}
    if (transport === "http") {
      const result = await request(
        operation === "subscribe" ? "POST" : "DELETE",
        watched,
        JSON.stringify({ subscriberAgentId: subscriber, ...extra }),
        opts?.token,
      )
      if (result.status === 403)
        expect(await result.json()).toMatchObject({ error: "scope-denied" })
      else expect(result.status).toBe(204)
      return result.status === 204
    }

    const client = opts?.client ?? (await connect())
    const result = await client.callTool(
      operation === "subscribe"
        ? { name: "session_subscribe", arguments: { agent: watched, subscriber, ...extra } }
        : {
            name: "agent_unsubscribe",
            arguments: { agentId: watched, subscriberAgentId: subscriber, ...extra },
          },
    )
    if (result.isError) expect(JSON.stringify(result)).toContain("scope-denied")
    else {
      const effective = subscriber ?? a
      const expected =
        operation === "subscribe"
          ? { ok: true, agent: watched, subscriber: effective }
          : { ok: true, agentId: watched, subscriberAgentId: effective }
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(expected) }])
    }
    return !result.isError
  }

  async function emitAndExpect(marker: string, toA: boolean, toC: boolean, watched = b) {
    const aCount = promptA.mock.calls.length
    const cCount = promptC.mock.calls.length
    eventBus.emit({ kind: "turn-ended", agentId: watched, at: 42, stopReason: marker })
    if (toA) {
      await vi.waitFor(() =>
        expect(promptA).toHaveBeenCalledWith("sub-a", expect.stringContaining(marker)),
      )
    }
    if (toC) {
      await vi.waitFor(() =>
        expect(promptC).toHaveBeenCalledWith("sub-c", expect.stringContaining(marker)),
      )
    }
    // The fixtures resolve immediately. Drain their delivery microtasks before negative checks.
    await setImmediate()
    expect(promptA).toHaveBeenCalledTimes(aCount + Number(toA))
    expect(promptC).toHaveBeenCalledTimes(cCount + Number(toC))
  }

  return {
    registry,
    eventBus,
    a,
    b,
    c,
    otherWatched,
    foreign,
    promptC,
    connect,
    request,
    change,
    emitAndExpect,
    getHost,
  }
}

const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
  resetScopePolicyForTests()
  resetAllowAlwaysGrantsForTests()
})

describe("agent event unsubscribe over public transports", () => {
  const pairs = [
    ["http", "http"],
    ["mcp", "mcp"],
    ["http", "mcp"],
    ["mcp", "http"],
  ] as const

  it.each(pairs)(
    "subscribes over %s and removes one pair over %s",
    async (registration, removal) => {
      const f = await fixture()
      const client = await f.connect()
      const opts = { client }
      expect(await f.change(registration, "subscribe", f.b, f.a, opts)).toBe(true)
      expect(
        await f.change(registration, "subscribe", f.b, f.c, {
          ...opts,
          includeLastAssistantText: true,
        }),
      ).toBe(true)
      expect(await f.change(registration, "subscribe", f.otherWatched, f.a, opts)).toBe(true)
      await f.emitAndExpect("before-removal", true, true)

      expect(await f.change(removal, "unsubscribe", f.b, f.a, opts)).toBe(true)
      await f.emitAndExpect("after-removal", false, true)
      expect(f.promptC).toHaveBeenLastCalledWith("sub-c", expect.stringContaining("quoted-reply"))

      expect(await f.change(removal, "unsubscribe", f.b, f.a, opts)).toBe(true)
      await f.emitAndExpect("after-repeat", false, true)
      await f.emitAndExpect("other-watched", true, false, f.otherWatched)

      // A still has a live pair in the bus when both registry records disappear.
      await f.registry.delete(f.otherWatched)
      await f.registry.delete(f.a)
      expect(await f.change(removal, "unsubscribe", f.otherWatched, f.a, opts)).toBe(true)
      expect(f.eventBus.subscribersOf(f.otherWatched)).toEqual([])
    },
  )

  it.each(["http", "mcp"] as const)(
    "enforces the subscriber's scope before removal over %s",
    async (transport) => {
      const f = await fixture()
      setScopePolicyOverride({ message: "deny", update: "deny", close: "deny" })
      const token = issueToken(f.foreign)
      const client = await f.connect({ [SCOPE_HEADER]: token })
      const scoped = { token, client }
      const operator = { client: await f.connect() }
      expect(await f.change(transport, "subscribe", f.b, f.a, operator)).toBe(true)
      expect(await f.change(transport, "subscribe", f.b, f.c, operator)).toBe(true)

      recordAllowAlwaysGrant(f.foreign, f.a, "subscribe")
      expect(await f.change(transport, "unsubscribe", f.b, f.a, scoped)).toBe(false)
      await f.emitAndExpect("after-subscribe-grant", true, true)
      recordAllowAlwaysGrant(f.foreign, f.a, "session/cancel")
      expect(await f.change(transport, "unsubscribe", f.b, f.a, scoped)).toBe(false)
      recordReplyGrant(f.foreign, f.c)
      expect(await f.change(transport, "unsubscribe", f.b, f.c, scoped)).toBe(false)
      await f.emitAndExpect("after-message-and-reply-grants", true, true)

      // Scope is checked before removal even if the pair is absent.
      expect(await f.change(transport, "unsubscribe", f.otherWatched, f.a, scoped)).toBe(false)

      expect(await f.change(transport, "subscribe", f.otherWatched, f.a, operator)).toBe(true)
      recordAllowAlwaysGrant(f.foreign, f.a, "unsubscribe")
      expect(await f.change(transport, "unsubscribe", f.b, f.a, scoped)).toBe(true)
      await f.emitAndExpect("after-unsubscribe-grant", false, true)
      expect(await f.change(transport, "unsubscribe", f.otherWatched, f.a, scoped)).toBe(true)
      expect(f.eventBus.subscribersOf(f.otherWatched)).toEqual([])
      expect(await f.change(transport, "unsubscribe", f.b, f.c, scoped)).toBe(false)
    },
  )

  it.each(["http", "mcp"] as const)(
    "uses message=allow for a foreign unsubscribe over %s without a caller host or grant",
    async (transport) => {
      const f = await fixture()
      const token = issueToken(f.foreign)
      const client = await f.connect({ [SCOPE_HEADER]: token })
      expect(await f.change("http", "subscribe", f.b, f.a)).toBe(true)
      setScopePolicyOverride({ message: "allow", update: "deny", close: "deny" })
      expect(await f.change(transport, "unsubscribe", f.b, f.a, { token, client })).toBe(true)
      expect(f.eventBus.subscribersOf(f.b)).toEqual([])
      expect(f.getHost).not.toHaveBeenCalledWith(f.foreign)
    },
  )

  it("defaults the MCP subscriber to the caller identity header", async () => {
    const f = await fixture()
    setScopePolicyOverride({ message: "deny" })
    const client = await f.connect({ [AGENT_ID_HEADER]: f.a, [SCOPE_HEADER]: issueToken(f.a) })
    expect(await f.change("http", "subscribe", f.b, f.a)).toBe(true)
    expect(await f.change("mcp", "unsubscribe", f.b, undefined, { client })).toBe(true)
    expect(f.eventBus.subscribersOf(f.b)).toEqual([])
  })

  it("rejects missing and malformed unsubscribe input without removing a pair", async () => {
    const f = await fixture()
    expect(await f.change("http", "subscribe", f.b, f.a)).toBe(true)
    for (const json of [
      "{",
      "{}",
      JSON.stringify({ subscriberAgentId: "bad-uuid" }),
      JSON.stringify({ subscriberAgentId: f.a, includeLastAssistantText: true }),
    ]) {
      expect((await f.request("DELETE", f.b, json)).status).toBe(400)
    }
    const client = await f.connect()
    for (const args of [
      { subscriberAgentId: f.a },
      { agent: f.b },
      { agentId: "" },
      { agentId: f.b, subscriberAgentId: "" },
      { agentId: f.b, subscriberAgentId: f.a, includeLastAssistantText: true },
      { agentId: f.b, subscriberAgentId: f.a, agent: f.b },
      { agentId: f.b, subscriberAgentId: f.a, subscriber: f.a },
    ]) {
      const result = await client.callTool({ name: "agent_unsubscribe", arguments: args })
      expect(result.isError).toBe(true)
    }
    const legacyAlias = await client.callTool({
      name: "session_unsubscribe",
      arguments: { agent: f.b, subscriber: f.a },
    })
    expect(legacyAlias.isError).toBe(true)
    expect(f.eventBus.subscribersOf(f.b)).toEqual([f.a])
  })
})
