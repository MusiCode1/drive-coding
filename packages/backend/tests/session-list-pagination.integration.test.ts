import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { createFromLineWire } from "@drive-coding/acp-wire"
import {
  type ChannelResponse,
  decodeWsServerMessage,
  encodeWsClientRequest,
  WS_RPC_METHOD,
} from "@drive-coding/core/session"
import { createAcpClient } from "@drive-coding/provider/client"
import { invalidateCache } from "@drive-coding/provider/config"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { afterEach, expect, it, vi } from "vitest"
import { WebSocket } from "ws"
import { createConnectionRegistry } from "../src/acp/connection-registry.js"
import { issueToken } from "../src/agent-scope.js"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import type { BootDeps } from "../src/boot/deps.js"
import { createWsStack } from "../src/boot/ws.js"
import { setSelfBaseUrlForTests } from "../src/instances.js"
import { registerRpcRoute } from "../src/session-host/http/rpc.js"
import { createAgentSessionRegistry, type HostResult } from "../src/session-host/registry.js"

const agentId = "pagination-fixture"
const savedSessionId = "fixture-saved"
const fixture = fileURLToPath(new URL("./fixtures/fake-acp-session-list.mjs", import.meta.url))
const opaqueCursor = "  second/+?=☃  "
const rawCaps = { list: {}, delete: {} }
const listCaps = { list: true, filterByCwd: true, delete: true }
const noCaps = { list: false, filterByCwd: false, delete: false }
const unsupportedDelete = { ok: false, unsupported: true }
const legacyOnly = {
  sessions: [],
  sessionCapabilities: null,
  capabilities: noCaps,
  legacyOnly: true,
}

type FixtureOptions = {
  agentCapabilities?: object
  emptyCursor?: boolean
  nullEnd?: boolean
  listError?: number
  deleteError?: number
  failLoad?: boolean
}

let stop: (() => Promise<void>) | undefined
afterEach(async () => {
  try {
    await stop?.()
  } finally {
    stop = undefined
    vi.unstubAllEnvs()
    invalidateCache()
  }
})

async function setup(options: FixtureOptions & { warm?: boolean } = {}) {
  const { warm, ...fixtureOptions } = options
  vi.stubEnv("CLI_SPECS_FILE", `${fixture}.jsonc`)
  vi.stubEnv("OPENCODE_ARGS", undefined)
  vi.stubEnv("AGENT_SIDECAR", "")
  vi.stubEnv(
    "CLI_SPECS_JSON",
    JSON.stringify({
      opencode: {
        bin: process.execPath,
        args: [fixture],
        supportsModelFlag: false,
        injectDriveCodingMcp: false,
      },
    }),
  )
  invalidateCache()

  const connectionRegistry = createConnectionRegistry()
  const conn = await connectionRegistry.connect(agentId, "opencode", {
    cwd: process.cwd(),
    shapeEnv: () => ({ SESSION_LIST_FIXTURE_OPTIONS: JSON.stringify(fixtureOptions) }),
  })
  const wire: { method: string; params: unknown }[] = []
  const unwatch = conn.onFrame((frame) => {
    if (frame.dir !== "out") return
    const { method, params } = JSON.parse(frame.raw)
    if (typeof method === "string") wire.push({ method, params })
  })
  stop = async () => {
    unwatch()
    await connectionRegistry.close(agentId)
  }

  if (warm) {
    // The first transport belongs to the synthetic owner. Closing it unsubscribes
    // from the line wire while the fixture process keeps the initialized state.
    const owner = await createAcpClient(createFromLineWire(conn), () => {})
    const initialized = await owner.newSession({ cwd: process.cwd(), mcpServers: [] })
    expect(initialized.sessionId).toBe(savedSessionId)
    owner.close()
  }

  const registry = createInMemoryAgentRegistry()
  const agentSessionRegistry = createAgentSessionRegistry({
    connectionRegistry,
    getAcpSessionId: () => (warm ? savedSessionId : undefined),
  })
  const app = new Hono()
  registerRpcRoute(app, agentSessionRegistry, registry)
  const stack = createWsStack()
  stack.wireRoutes(app, { agentSessionRegistry, connectionRegistry, registry } as BootDeps)
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 })
  stack.attachUpgradeHandler(server)
  const sockets: WebSocket[] = []
  const closeConnection = stop
  stop = async () => {
    for (const socket of sockets) socket.terminate()
    stack.stop()
    stack.sessionWss.close()
    stack.echoWss.close()
    await agentSessionRegistry.getHost(agentId)?.dispose()
    agentSessionRegistry.unregisterHost(agentId)
    agentSessionRegistry.stop()
    await closeConnection()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    setSelfBaseUrlForTests(undefined)
  }
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected HTTP server address")
  const base = `http://127.0.0.1:${address.port}`
  setSelfBaseUrlForTests(base)

  return {
    wire,
    agentSessionRegistry,
    async http(body: object, headers?: Record<string, string>): Promise<ChannelResponse> {
      const response = await fetch(`${base}/api/agents/${agentId}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      })
      return { status: response.status, body: await response.json() }
    },
    async connectWs() {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/session/${agentId}`)
      sockets.push(socket)
      const responses = new Map<number, ChannelResponse>()
      const frames: string[] = []
      socket.on("message", (raw) => {
        const message = decodeWsServerMessage(raw.toString())
        if (message?.kind === "response")
          responses.set(message.response.id, message.response.result)
        if (message?.kind === "frame") frames.push(message.frame.event)
      })
      await once(socket, "open")
      let nextId = 0
      return {
        frames,
        async rpc(body: object) {
          const id = ++nextId
          socket.send(
            encodeWsClientRequest({ jsonrpc: "2.0", id, method: WS_RPC_METHOD, params: body }),
          )
          return vi.waitFor(() => {
            const response = responses.get(id)
            if (!response) throw new Error(`Missing WS response ${id}`)
            return response
          })
        },
      }
    },
  }
}

it.each([undefined, null, {}, { futureField: "ignored" }])(
  "keeps the exact legacy envelope and sends an empty query for params %j",
  async (params) => {
    const { http, wire } = await setup()
    expect(await http({ method: "listSessions", params, waitMs: { ignored: true } })).toEqual({
      status: 200,
      body: {
        sessions: [{ sessionId: "first", cwd: "/fixture/all" }],
        sessionCapabilities: rawCaps,
      },
    })
    expect(wire.map(({ method }) => method)).toEqual(["initialize", "session/new", "session/list"])
    expect(wire.at(-1)).toEqual({ method: "session/list", params: {} })
  },
)

it.each([
  [opaqueCursor, false, "/fixture/with spaces"],
  ["", true, "C:\\fixture\\with spaces"],
  [opaqueCursor, true, "\\\\server\\share\\fixture"],
] as const)(
  "passes both pages and the opaque cursor %j over HTTP and WS",
  async (cursor, nullEnd, cwd) => {
    const { http, connectWs, wire } = await setup({ nullEnd, emptyCursor: cursor === "" })
    const first = await http({ method: "session/list", params: { cwd, ignored: 42 } })
    expect(first).toEqual({
      status: 200,
      body: {
        sessions: [{ sessionId: "first", cwd }],
        sessionCapabilities: rawCaps,
        capabilities: listCaps,
        nextCursor: cursor,
      },
    })
    const ws = await connectWs()
    expect(
      await ws.rpc({ method: "listSessions", params: { paged: true, cwd, cursor }, waitMs: [] }),
    ).toEqual({
      status: 200,
      body: {
        sessions: [{ sessionId: "second", cwd }],
        sessionCapabilities: rawCaps,
        capabilities: listCaps,
      },
    })
    expect(wire.slice(2)).toEqual([
      { method: "session/list", params: { cwd } },
      { method: "session/list", params: { cwd, cursor } },
    ])
  },
)

it("preserves a provider invalid-params error and sends no implicit cwd", async () => {
  const { http, wire } = await setup()
  expect(await http({ method: "session/list", params: { cursor: "stale" } })).toEqual({
    status: 502,
    body: { error: "fixture rejected cursor", code: -32602 },
  })
  expect(wire.slice(2)).toEqual([{ method: "session/list", params: { cursor: "stale" } }])
})

it.each([
  [{}, null],
  [{ sessionCapabilities: {} }, {}],
  [{ sessionCapabilities: null }, null],
  [{ sessionCapabilities: [] }, null],
  [{ sessionCapabilities: { list: null, delete: [] } }, { list: null, delete: [] }],
  [{ sessionCapabilities: { list: true, delete: "yes" } }, { list: true, delete: "yes" }],
] as const)(
  "skips both wire calls with a known negative initialize declaration %j",
  async (agentCapabilities, sessionCapabilities) => {
    const { http, wire } = await setup({ agentCapabilities })
    expect(await http({ method: "session/list" })).toEqual({
      status: 200,
      body: { sessions: [], sessionCapabilities },
    })
    expect(await http({ method: "session/list", params: { paged: true } })).toEqual({
      status: 200,
      body: { sessions: [], sessionCapabilities, capabilities: noCaps },
    })
    expect(await http({ method: "session/delete", params: { sessionId: "first" } })).toEqual({
      status: 200,
      body: unsupportedDelete,
    })
    expect(wire.map(({ method }) => method)).toEqual(["initialize", "session/new"])
  },
)

it("uses a delete declaration independently of list", async () => {
  const { http, wire } = await setup({ agentCapabilities: { sessionCapabilities: { delete: {} } } })
  expect(await http({ method: "session/list", params: { paged: true } })).toEqual({
    status: 200,
    body: {
      sessions: [],
      sessionCapabilities: { delete: {} },
      capabilities: { ...noCaps, delete: true },
    },
  })
  expect(
    await http({ method: "deleteSession", params: { sessionId: "first" }, waitMs: false }),
  ).toEqual({
    status: 200,
    body: { ok: true },
  })
  expect(wire.slice(2)).toEqual([{ method: "session/delete", params: { sessionId: "first" } }])
})

it("maps advertised method-not-found once per operation and leaves the raw declaration intact", async () => {
  const { http, wire } = await setup({ listError: -32601, deleteError: -32601 })
  expect(await http({ method: "session/list", params: { paged: true } })).toEqual({
    status: 200,
    body: { sessions: [], sessionCapabilities: rawCaps, capabilities: { ...noCaps, delete: true } },
  })
  expect(await http({ method: "deleteSession", params: { sessionId: "first" } })).toEqual({
    status: 200,
    body: unsupportedDelete,
  })
  expect(wire.slice(2)).toEqual([
    { method: "session/list", params: {} },
    { method: "session/delete", params: { sessionId: "first" } },
  ])
})

it.each([false, true])(
  "preserves only warm legacy operations with failLoad=%s",
  async (failLoad) => {
    const { http, wire, agentSessionRegistry } = await setup({ warm: true, failLoad })
    const ownerOps = wire.map(({ method }) => method)
    expect(ownerOps).toEqual(["initialize", "session/new"])

    expect(await http({ method: "session/list", params: { paged: true } })).toEqual({
      status: 200,
      body: legacyOnly,
    })
    expect(wire.map(({ method }) => method)).toEqual([
      ...ownerOps,
      "session/load",
      ...(failLoad ? ["session/new"] : []),
    ])
    expect(wire[2]?.params).toMatchObject({ sessionId: savedSessionId })
    expect(agentSessionRegistry.getHost(agentId)?.state.sessionId).toBe(
      failLoad ? "fixture-new" : savedSessionId,
    )
    const beforeManagement = wire.length
    expect(await http({ method: "listSessions", params: null })).toEqual({
      status: 200,
      body: { sessions: [{ sessionId: "first", cwd: "/fixture/all" }], sessionCapabilities: null },
    })
    const deletion = { method: "session/delete", params: { sessionId: "first" } }
    expect(
      await http(deletion, { "X-Drive-Coding-Scope": issueToken("outside-pagination-fixture") }),
    ).toMatchObject({ status: 403 })
    expect(await http({ method: "deleteSession", params: { sessionId: 38 } })).toMatchObject({
      status: 400,
    })
    expect(await http(deletion, { "X-Drive-Coding-Scope": issueToken(agentId) })).toEqual({
      status: 200,
      body: { ok: true },
    })
    expect(wire.slice(beforeManagement)).toEqual([
      { method: "session/list", params: {} },
      { method: "session/delete", params: { sessionId: "first" } },
    ])
  },
)

it("maps method-not-found for the established warm legacy operations", async () => {
  const { http, wire } = await setup({ warm: true, listError: -32601, deleteError: -32601 })
  expect(await http({ method: "listSessions" })).toEqual({
    status: 200,
    body: { sessions: [], sessionCapabilities: null },
  })
  expect(await http({ method: "session/list", params: { paged: true } })).toEqual({
    status: 200,
    body: legacyOnly,
  })
  expect(await http({ method: "deleteSession", params: { sessionId: "first" } })).toEqual({
    status: 200,
    body: unsupportedDelete,
  })
  expect(wire.map(({ method }) => method)).toEqual([
    "initialize",
    "session/new",
    "session/load",
    "session/list",
    "session/delete",
  ])
})

it("rejects malformed list inputs before the cold HTTP host can touch the wire", async () => {
  const { http, wire, agentSessionRegistry } = await setup()
  const getOrCreateHost = vi.spyOn(agentSessionRegistry, "getOrCreateHost")
  for (const params of [
    [],
    "bad",
    { paged: false },
    { cursor: 7 },
    { cwd: 7 },
    { cwd: "relative" },
    { cwd: "C:relative" },
    { cwd: "\\\\server" },
  ]) {
    expect(await http({ method: "session/list", params })).toMatchObject({ status: 400 })
  }
  expect(await http({ method: "listSessions", params: { paged: null } })).toMatchObject({
    status: 400,
  })
  expect(getOrCreateHost).not.toHaveBeenCalled()
  expect(wire).toEqual([])
})

it("rejects malformed WS list while the viewer alone waits for host creation", async () => {
  const { connectWs, wire, agentSessionRegistry } = await setup()
  const barrier = Promise.withResolvers<HostResult>()
  const getOrCreateHost = vi
    .spyOn(agentSessionRegistry, "getOrCreateHost")
    .mockImplementationOnce(() => barrier.promise)
  try {
    const ws = await connectWs()
    await vi.waitFor(() => expect(getOrCreateHost).toHaveBeenCalledExactlyOnceWith(agentId))
    expect(await ws.rpc({ method: "listSessions", params: { cursor: null } })).toMatchObject({
      status: 400,
    })
    expect(getOrCreateHost).toHaveBeenCalledTimes(1)
    expect(ws.frames).toEqual([])
    expect(wire).toEqual([])
  } finally {
    barrier.resolve({ ok: false, reason: "not-found" })
  }
})
