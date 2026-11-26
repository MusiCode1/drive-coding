/**
 * http-mcp-public-url.test.ts — PUBLIC_BASE_URL split (chat url vs child loopback).
 */

import {
  type AgentRegistry,
  MCP_AGENT_CONFIGURE_HINT,
  MCP_CONFIGURE_HINT,
} from "@drive-coding/core"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import { createInMemoryAgentRegistry } from "../agents/registry.js"
import { encodeSidecarAgentEnv } from "../agents/sidecar-agent-env.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import { getSelfBaseUrl, setSelfBaseUrl, setSelfBaseUrlForTests } from "../instances.js"
import { createAgentEventBus } from "../session-host/agent-events.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { wrapOrchestratorWithAgentEvents } from "./agent-events-orchestrator.js"
import { registerMcpHttp } from "./http-mcp.js"
import { defaultPublicUrl, loopbackBaseUrl } from "./public-url.js"

function makeStubSessionRegistry(): AgentSessionRegistry {
  return {
    getHost: vi.fn((id: string) => ({
      state: { sessionId: `sess-${id}`, turnState: "idle", modes: {}, configOptions: [] },
    })),
    getOrCreateHost: vi.fn(async (id: string) => ({
      ok: true,
      entry: {
        host: {
          state: { sessionId: `sess-${id}`, turnState: "idle", modes: {}, configOptions: [] },
          prompt: vi.fn(),
          setConfigOption: vi.fn(),
        },
        broadcaster: {},
      },
    })),
    getBroadcaster: vi.fn(() => undefined),
    unregisterHost: vi.fn(),
    notifySessionAttached: vi.fn(async () => {}),
    getCwd: vi.fn(() => undefined),
    getEpoch: vi.fn(() => 0),
    touchOwner: vi.fn(),
    getRuntimeInfo: vi.fn(() => null),
    stop: vi.fn(),
  } as unknown as AgentSessionRegistry
}

function makeOrchestrator(registry: AgentRegistry): AgentOrchestrator {
  return {
    createAndSpawn: vi.fn(async (input) => {
      const agent = await registry.create(input)
      return {
        agentId: agent.id,
        cwd: agent.cwd,
        cliKind: agent.cliKind,
        wsUrl: "",
        bridgePort: 0,
        status: "spawning" as const,
      }
    }),
    deleteAndKill: vi.fn(async () => {}),
    deleteAllAndKill: vi.fn(async () => ({ closed: [], failed: [] })),
    getBridgePort: vi.fn(() => 0),
  }
}

const envBackup: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ["PUBLIC_BASE_URL", "PORT", "DRIVE_CODING_HOST", "MCP_HTTP"]) {
    envBackup[key] = process.env[key]
  }
})

afterEach(() => {
  for (const [key, val] of Object.entries(envBackup)) {
    if (val === undefined) delete process.env[key]
    else process.env[key] = val
  }
})

describe("defaultPublicUrl / loopbackBaseUrl", () => {
  it("with PUBLIC_BASE_URL → defaultPublicUrl uses it; loopback unchanged", () => {
    const cfg = {
      port: 4360,
      host: "127.0.0.1",
      publicBaseUrl: "https://public.example.com",
    }
    expect(defaultPublicUrl(cfg)).toBe("https://public.example.com")
    expect(loopbackBaseUrl(cfg)).toBe("http://127.0.0.1:4360")
  })

  it("without PUBLIC_BASE_URL → both return loopback", () => {
    const cfg = { port: 4360, host: "127.0.0.1" }
    expect(defaultPublicUrl(cfg)).toBe("http://127.0.0.1:4360")
    expect(loopbackBaseUrl(cfg)).toBe("http://127.0.0.1:4360")
  })
})

const names = ["session_open", "agent_open"] as const
type OpenTool = (typeof names)[number]
const loopback = "http://127.0.0.1:4360"
const publicOrigin = "https://instance.example.test"
const override = "https://override.example.test/"
const legacyBase = "https://legacy.example.test/"
const parent = "00000000-0000-4000-8000-000000000001"
const otherParent = "00000000-0000-4000-8000-000000000002"

function makeApp(publicBaseUrl?: string, sidecar?: string) {
  const app = new Hono()
  const registry = createInMemoryAgentRegistry()
  const orchestrator = makeOrchestrator(registry)
  const agentSessionRegistry = makeStubSessionRegistry()
  const eventBus = createAgentEventBus()
  const subscribe = vi.spyOn(eventBus, "subscribe")
  registerMcpHttp(app, {
    registry,
    orchestrator: wrapOrchestratorWithAgentEvents(orchestrator, eventBus),
    agentSessionRegistry,
    eventBus,
    env: {
      AGENT_SIDECAR: sidecar,
      CLI_SPECS_FILE: "/nonexistent/drive-coding-test/cli-specs.jsonc",
    },
    urlConfig: { port: 4360, host: "127.0.0.1", publicBaseUrl },
  })
  return { app, registry, orchestrator, agentSessionRegistry, subscribe }
}

async function open(
  app: Hono,
  name: OpenTool,
  args: Record<string, unknown> = {},
  caller?: string,
) {
  const client = new Client({ name: "public-url-test", version: "0.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test/api/mcp"), {
    fetch: (async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init)
      return app.request(req)
    }) as typeof fetch,
    requestInit: {
      headers: {
        Origin: "https://caller.example.test",
        ...(caller && { [AGENT_ID_HEADER]: caller }),
      },
    },
  })
  await client.connect(transport)
  try {
    return await client.callTool({
      name,
      arguments: {
        [name === "agent_open" ? "cliKind" : "cli"]: "cursor",
        cwd: "/tmp/public-url-test",
        ...args,
      },
    })
  } finally {
    await client.close()
  }
}

function expectOpened(result: Awaited<ReturnType<typeof open>>, name: OpenTool, base: string) {
  expect(result.isError).toBeUndefined()
  expect(result.content).toEqual([{ type: "text", text: expect.any(String) }])
  const [content] = result.content as [{ text: string }]
  const body: Record<string, unknown> = JSON.parse(content.text)
  const identity = name === "agent_open" ? "agentId" : "agent"
  const id = body[identity]
  expect(body).toEqual({
    [identity]: expect.any(String),
    sessionId: `sess-${id}`,
    url: `${base}/chat/cursor/sess-${id}?sessionTransport=http`,
    cli: { kind: "cursor", displayName: "cursor" },
    modes: {},
    configOptions: [],
    hint: name === "agent_open" ? MCP_AGENT_CONFIGURE_HINT : MCP_CONFIGURE_HINT,
  })
}

describe("MCP open chat URLs", () => {
  describe.each(names)("%s", (name) => {
    it.each([
      { config: publicOrigin, args: {}, expected: publicOrigin },
      { config: undefined, args: {}, expected: loopback },
      { config: "invalid origin", args: {}, expected: loopback },
      { config: publicOrigin, args: { publicUrl: override }, expected: override.slice(0, -1) },
      {
        config: publicOrigin,
        args: { base: legacyBase },
        expected: name === "agent_open" ? publicOrigin : legacyBase.slice(0, -1),
      },
      {
        config: undefined,
        args: { base: legacyBase },
        expected: name === "agent_open" ? loopback : legacyBase.slice(0, -1),
      },
      {
        config: publicOrigin,
        args: { publicUrl: override, base: legacyBase },
        expected: override.slice(0, -1),
      },
      { config: publicOrigin, args: { publicUrl: "", base: legacyBase }, expected: "" },
    ])(
      "returns the complete chat URL for $args with config $config",
      async ({ config, args, expected }) => {
        const { app } = makeApp(config)
        expectOpened(await open(app, name, args), name, expected)
      },
    )

    it.each([undefined, "cursor"])("forwards caller env with sidecar=%s", async (sidecar) => {
      const { app, registry, orchestrator } = makeApp(publicOrigin, sidecar)
      const caller = await registry.create({ cliKind: "cursor", cwd: "/tmp" })
      const env = {
        DRIVE_CODING_BASE: "caller-drive-base",
        DC_BASE: "caller-base",
        DC_PARENT: otherParent,
        A6_MARKER: "present",
      }
      expectOpened(
        await open(app, name, { publicUrl: override, env }, caller.id),
        name,
        override.slice(0, -1),
      )
      expect(orchestrator.createAndSpawn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          env: { ...env, DC_PARENT: caller.id },
          parentAgentId: caller.id,
        }),
      )
    })

    it.each([undefined, "cursor"])(
      "passes an empty env when omitted with sidecar=%s",
      async (sidecar) => {
        const { app, orchestrator } = makeApp(publicOrigin, sidecar)
        expectOpened(await open(app, name), name, publicOrigin)
        expect(orchestrator.createAndSpawn).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ env: {} }),
        )
      },
    )
  })
})

function withEncodedSize(
  target: number,
  env: Record<string, string>,
  base: string,
  effectiveParent: string,
) {
  const projection = {
    ...env,
    DC_PARENT: effectiveParent,
    DRIVE_CODING_BASE: base,
    DC_BASE: base,
  }
  const unpadded = encodeSidecarAgentEnv({ ...projection, PADDING: "" }).length
  // Base64 advances in groups of four, each representing up to three JSON bytes.
  const start = ((target - unpadded) / 4) * 3
  for (let length = start - 2; length <= start + 2; length++) {
    const PADDING = "x".repeat(length)
    if (encodeSidecarAgentEnv({ ...projection, PADDING }).length === target) {
      return { ...env, PADDING }
    }
  }
  throw new Error(`no padding for encoded size ${target}`)
}

describe("MCP open sidecar input budget", () => {
  const competingBase = {
    DRIVE_CODING_BASE: "drive".repeat(100),
    DC_BASE: "legacy".repeat(100),
    DC_PARENT: otherParent,
  }
  const cases = [
    ...names.flatMap((name) => [
      { name, args: {}, measuredBase: loopback, expected: publicOrigin, env: {} },
      {
        name,
        args: { publicUrl: override },
        measuredBase: override.slice(0, -1),
        expected: override.slice(0, -1),
        env: competingBase,
      },
      { name, args: { publicUrl: "" }, measuredBase: "", expected: "", env: competingBase },
    ]),
    {
      name: "session_open" as const,
      args: { base: legacyBase },
      measuredBase: legacyBase.slice(0, -1),
      expected: legacyBase.slice(0, -1),
      env: competingBase,
    },
  ]

  describe.each(cases)(
    "$name measures BASE=$measuredBase",
    ({ name, args, measuredBase, expected, env }) => {
      it.each([61_436, 61_440, 61_444])("validates the exact encoded size %i", async (size) => {
        const fixture = makeApp(publicOrigin, "cursor")
        const callerEnv = withEncodedSize(size, env, measuredBase, parent)
        const fields =
          name === "agent_open"
            ? { parentAgentId: parent, subscribeOnOpenAgentId: parent }
            : { parent, notifyOnDone: parent }
        const result = await open(fixture.app, name, { ...args, ...fields, env: callerEnv })
        if (size <= 61_440) {
          expectOpened(result, name, expected)
          expect(fixture.orchestrator.createAndSpawn).toHaveBeenCalledOnce()
          expect(fixture.agentSessionRegistry.getOrCreateHost).toHaveBeenCalledOnce()
          expect(fixture.subscribe).toHaveBeenCalledOnce()
          expect(await fixture.registry.list()).toHaveLength(1)
        } else {
          expect(result).toEqual({
            isError: true,
            content: [{ type: "text", text: "agent env too large: 61444 > 61440 (encoded)" }],
          })
          expect(fixture.orchestrator.createAndSpawn).not.toHaveBeenCalled()
          expect(fixture.agentSessionRegistry.getOrCreateHost).not.toHaveBeenCalled()
          expect(fixture.subscribe).not.toHaveBeenCalled()
          expect(await fixture.registry.list()).toEqual([])
        }
      })
    },
  )

  it.each(names)("checks cwd and caller parent before the env budget for %s", async (name) => {
    const fixture = makeApp(publicOrigin, "cursor")
    const caller = await fixture.registry.create({ cliKind: "cursor", cwd: "/tmp" })
    const env = { PADDING: "x".repeat(46_100) }
    const badCwd = await open(fixture.app, name, { cwd: "relative", env })
    expect(badCwd).toEqual({
      isError: true,
      content: [{ type: "text", text: "invalid cwd: not_absolute" }],
    })
    const parentField = name === "agent_open" ? "parentAgentId" : "parent"
    const conflict = await open(fixture.app, name, { [parentField]: otherParent, env }, caller.id)
    expect(conflict).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: `${AGENT_ID_HEADER} (${caller.id}) conflicts with explicit parent (${otherParent})`,
        },
      ],
    })
    expect(fixture.orchestrator.createAndSpawn).not.toHaveBeenCalled()
    expect(fixture.agentSessionRegistry.getOrCreateHost).not.toHaveBeenCalled()
    expect(fixture.subscribe).not.toHaveBeenCalled()
    expect(await fixture.registry.list()).toEqual([caller])
  })
})

it("uses the configured host for child BASE and the listen address for child MCP", () => {
  const config = { host: "0.0.0.0", port: 4360 }
  expect(loopbackBaseUrl(config)).toBe("http://0.0.0.0:4360")
  try {
    setSelfBaseUrl({
      ...config,
      pid: process.pid,
      version: "0.0.0",
      cwd: "/tmp",
      https: false,
      startedAt: 0,
    })
    expect(getSelfBaseUrl()).toBe(loopback)
  } finally {
    setSelfBaseUrlForTests(undefined)
  }
})
