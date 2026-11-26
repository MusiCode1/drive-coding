import { spawn } from "node:child_process"
import { once } from "node:events"
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import * as net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { decodePing, encodePong } from "@drive-coding/acp-wire"
import * as unix from "@drive-coding/acp-wire/node"
import { decodeWsServerMessage } from "@drive-coding/core/session"
import type { ProviderConnection, WireFrame } from "@drive-coding/provider/connection"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { afterEach, expect, it, vi } from "vitest"
import { WebSocket } from "ws"
import { connectViaSidecar, RestoreSidecarGone } from "../acp/connect-via-sidecar.js"
import { createConnectionRegistry } from "../acp/connection-registry.js"
import type { BootDeps } from "../boot/deps.js"
import { createWsStack } from "../boot/ws.js"
import { registerEventsRoute } from "../session-host/http/events.js"
import { registerStateRoute } from "../session-host/http/state.js"
import { createAgentSessionRegistry } from "../session-host/registry.js"
import * as launcher from "./agent-launcher.js"
import * as sockets from "./agent-sockets.js"
import { agentSocketPath, probeAgentSocket } from "./agent-sockets.js"
import { createPersistentAgentRegistry } from "./persistent-registry.js"
import { restorePersistedAgents } from "./restore-agents.js"
import {
  createInitializeCapabilitiesTap,
  MAX_SIDECAR_CONTROL_BYTES,
} from "./sidecar-initialize-capabilities.js"

const cleanups: Array<() => unknown> = []

vi.mock("node:net", async () => {
  const net = await vi.importActual<typeof import("node:net")>("node:net")
  return { ...net, connect: vi.fn(net.connect) }
})

afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  }
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "c80-"))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function framesOf(conn: ProviderConnection): WireFrame[] {
  const frames: WireFrame[] = []
  cleanups.push(conn.onFrame((frame) => frames.push(frame)))
  return frames
}

function methods(frames: WireFrame[]): string[] {
  return frames.filter((frame) => frame.dir === "out").map((frame) => frame.type)
}

function trackHost(hosts: ReturnType<typeof createAgentSessionRegistry>, id: string) {
  const dispose = async () => {
    await hosts.getHost(id)?.dispose()
    hosts.unregisterHost(id)
    hosts.stop()
  }
  cleanups.push(dispose)
  return dispose
}

async function startSidecar(
  socket: string,
  id: string,
  dir: string,
  agentCapabilities: object,
  script?: string,
) {
  const fixture = join(dir, "cli.mjs")
  if (script === undefined) {
    copyFileSync(
      new URL("../../tests/fixtures/fake-acp-session-list.mjs", import.meta.url),
      fixture,
    )
  } else {
    writeFileSync(fixture, script)
  }
  const sidecar = fileURLToPath(new URL("../bin/agent-sidecar.ts", import.meta.url))
  const child = spawn(
    "bun",
    [
      "--no-env-file",
      sidecar,
      "--agent-id",
      id,
      "--cli-kind",
      "cursor",
      "--cwd",
      dir,
      "--socket",
      socket,
      "--mode",
      "pipe",
    ],
    {
      env: {
        ...process.env,
        CLI_SPECS_FILE: join(dir, "cli-specs.jsonc"),
        CLI_SPECS_JSON: JSON.stringify({ cursor: { bin: process.execPath, args: [fixture] } }),
        SESSION_LIST_FIXTURE_OPTIONS: JSON.stringify({ agentCapabilities }),
        LOG_LEVEL: "silent",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  )
  let stderr = ""
  child.stderr.on("data", (data) => {
    stderr += String(data)
  })
  const exited = once(child, "exit")
  cleanups.push(async () => {
    if (child.kill("SIGTERM")) await exited
  })
  await vi.waitFor(
    async () => {
      expect(child.exitCode, stderr).toBeNull()
      expect(await probeAgentSocket(socket)).toMatchObject({
        state: "alive",
        info: { pid: child.pid },
      })
    },
    { timeout: 8_000 },
  )
  return child.pid
}

async function readSseSnapshot(app: Hono, path: string): Promise<string> {
  const response = await app.request(`${path}/events?snapshot=full`)
  expect(response.status).toBe(200)
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Expected an SSE body")
  const decoder = new TextDecoder()
  let buf = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error("SSE ended before snapshot")
      buf += decoder.decode(value, { stream: true })
      let end = buf.indexOf("\n\n")
      while (end !== -1) {
        const event = buf.slice(0, end)
        const snapshot = /^event: snapshot\n(?:id: .*\n)?data: (.+)$/m.exec(event)?.[1]
        if (snapshot !== undefined) return snapshot
        buf = buf.slice(end + 2)
        end = buf.indexOf("\n\n")
      }
    }
  } finally {
    await reader.cancel()
  }
}

async function readWsSnapshot(
  deps: Pick<BootDeps, "registry" | "connectionRegistry" | "agentSessionRegistry">,
  id: string,
): Promise<string> {
  const app = new Hono()
  const stack = createWsStack()
  stack.wireRoutes(app, deps as BootDeps)
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 })
  stack.attachUpgradeHandler(server)
  let ws: WebSocket | undefined
  try {
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Expected HTTP server address")
    ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/session/${id}?snapshot=full`)
    let snapshot: string | undefined
    ws.on("message", (raw) => {
      const message = decodeWsServerMessage(raw.toString())
      if (message?.kind === "frame" && message.frame.event === "snapshot") {
        snapshot = message.frame.data
      }
    })
    await once(ws, "open")
    return await vi.waitFor(
      () => {
        if (snapshot === undefined) throw new Error("WebSocket has not delivered a snapshot")
        return snapshot
      },
      { timeout: 5_000 },
    )
  } finally {
    ws?.terminate()
    stack.stop()
    stack.sessionWss.close()
    stack.echoWss.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const privateValue = "fixture-init-only-marker"
const fixtureCaps = {
  loadSession: true,
  promptCapabilities: { image: true, audio: true, _meta: { value: privateValue } },
  sessionCapabilities: { list: { _meta: { value: privateValue } } },
  _meta: { nested: { value: privateValue } },
}

it.each(["sse", "ws"] as const)(
  "restores image when %s opens the original session first",
  async (firstViewer) => {
    const dir = scratch()
    vi.stubEnv("DC_DEPLOYMENT_DIR", dir)
    vi.stubEnv("AGENT_SIDECAR", "cursor")
    const file = join(dir, "agents.json")
    const registry = createPersistentAgentRegistry({ file })
    const { id } = await registry.create({ cliKind: "cursor", cwd: dir, modelOverride: null })
    const socket = agentSocketPath(dir, id)
    const pid = await startSidecar(socket, id, dir, fixtureCaps)
    const inode = statSync(socket, { bigint: true }).ino

    const connections = createConnectionRegistry()
    const coldConn = await connections.connect(id, "cursor", { cwd: dir, intent: "attachOnly" })
    cleanups.push(() => connections.close(id))
    const coldFrames = framesOf(coldConn)
    const coldHosts = createAgentSessionRegistry({
      connectionRegistry: connections,
      onSessionAttached: async (agentId, sessionId) => {
        await registry.update(agentId, { acpSessionId: sessionId })
      },
    })
    const dispose = trackHost(coldHosts, id)
    expect(await coldHosts.getOrCreateHost(id)).toMatchObject({ ok: true })
    expect(coldConn.capabilities.image).toBe(true)
    expect(methods(coldFrames)).toEqual(["initialize", "session/new"])
    expect(coldFrames.find((frame) => frame.dir === "in")?.raw).toContain(privateValue)
    const coldPong = await probeAgentSocket(socket)
    expect(coldPong).toMatchObject({
      state: "alive",
      info: {
        agentId: id,
        pid,
        hasOwner: true,
        initCapabilities: { protocolVersion: 1, image: true },
      },
    })
    if (coldPong.state !== "alive") throw new Error("Expected a live sidecar")
    expect(coldPong.info?.initCapabilities).toEqual({ protocolVersion: 1, image: true })
    expect(JSON.stringify(coldPong)).not.toContain(privateValue)
    await registry.flush()
    expect(await registry.get(id)).toMatchObject({ acpSessionId: "fixture-saved" })
    await dispose()
    await connections.close(id)

    const adoptedRegistry = createPersistentAgentRegistry({ file })
    const adoptedConnections = createConnectionRegistry()
    cleanups.push(() => adoptedConnections.close(id))
    const acpSessionIds = new Map<string, string>()
    const probe = vi.spyOn(sockets, "probeAgentSocket")
    await restorePersistedAgents({
      registry: adoptedRegistry,
      connections: adoptedConnections,
      acpSessionIds,
    })
    expect(probe.mock.calls).toEqual([[socket], [socket]])
    probe.mockRestore()
    expect(await adoptedRegistry.get(id)).toMatchObject({ id, acpSessionId: "fixture-saved" })
    expect(await probeAgentSocket(socket)).toMatchObject({
      state: "alive",
      info: { agentId: id, pid, startedAt: coldPong.info?.startedAt },
    })
    expect(statSync(socket, { bigint: true }).ino).toBe(inode)
    const adoptedConn = adoptedConnections.get(id)
    if (!adoptedConn) throw new Error("Expected an adopted connection")
    expect(adoptedConn.pid).toBe(pid)
    expect(adoptedConn.capabilities.image).toBe(true)
    const adoptedFrames = framesOf(adoptedConn)
    const adoptedHosts = createAgentSessionRegistry({
      connectionRegistry: adoptedConnections,
      getAcpSessionId: (agentId) => acpSessionIds.get(agentId),
    })
    trackHost(adoptedHosts, id)
    const app = new Hono()
    registerEventsRoute(app, adoptedHosts, adoptedConnections)
    registerStateRoute(app, adoptedHosts)
    const path = `/api/agents/${id}`
    expect((await app.request(`${path}/state`)).status).toBe(404)
    const viewers = {
      sse: () => readSseSnapshot(app, path),
      ws: () =>
        readWsSnapshot(
          {
            registry: adoptedRegistry,
            connectionRegistry: adoptedConnections,
            agentSessionRegistry: adoptedHosts,
          },
          id,
        ),
    }
    const first = await viewers[firstViewer]()
    const second = await viewers[firstViewer === "sse" ? "ws" : "sse"]()
    for (const snapshot of [first, second]) {
      expect(snapshot).not.toContain(privateValue)
      expect(JSON.parse(snapshot)).toMatchObject({
        sessionId: "fixture-saved",
        updates: expect.arrayContaining([
          expect.objectContaining({
            sessionUpdate: "_drive/session_update",
            changes: expect.objectContaining({
              capabilities: expect.objectContaining({ image: true }),
            }),
          }),
        ]),
      })
    }
    const state = await app.request(`${path}/state`)
    expect(state.status).toBe(200)
    expect(await state.json()).toMatchObject({
      sessionId: "fixture-saved",
      capabilities: { image: true },
    })
    expect(methods(adoptedFrames)).toEqual(["session/load"])
    const load = adoptedFrames.find((frame) => frame.dir === "out")
    expect(load?.parsed).toMatchObject({ params: { sessionId: "fixture-saved" } })
    expect(adoptedFrames.find((frame) => frame.dir === "in")?.parsed).toMatchObject({
      id: load?.id,
      result: {},
    })
    expect(
      adoptedConn.capabilities.image,
      "image on the adopted connection after successful load",
    ).toBe(true)
  },
  15_000,
)

const versionedImage = { protocolVersion: 1, image: true } as const
const initialize = (id: string | number) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "initialize" })
const imageResult = (id: string | number, image: boolean) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image } } },
  })
const otherRequest = (id: number) => JSON.stringify({ jsonrpc: "2.0", id, method: "session/list" })

it("learns only from the matching response and keeps the first successful projection", () => {
  const tap = createInitializeCapabilitiesTap()
  const owner = {}
  tap.onAccept(owner)
  tap.onRequest(owner, owner, initialize(1))
  tap.onResponse(owner, imageResult(2, false))
  tap.onResponse(owner, imageResult("1", false))
  expect(tap.capabilities).toBeUndefined()
  tap.onResponse(owner, imageResult(1, true))
  expect(tap.capabilities).toEqual(versionedImage)
  const nextOwner = {}
  tap.onAccept(nextOwner)
  tap.onRequest(nextOwner, nextOwner, initialize(1))
  tap.onResponse(nextOwner, imageResult(1, false))
  expect(tap.capabilities).toEqual(versionedImage)
})

it.each([
  "matching error",
  "matching invalid response",
  "provider protocol version mismatch",
  "owner replaced while pending",
  "owner vanished before response",
  "late request from replaced peer",
  "competing initialize",
  "request reusing the pending id",
  "other request before initialize",
  "oversized initialize request",
  "oversized request while pending",
  "oversized response while pending",
] as const)("abandons learning for this process after %s", (obstruction) => {
  const tap = createInitializeCapabilitiesTap()
  const peer = {}
  const replacement = {}
  const oversized = "☃".repeat(24_000)
  tap.onAccept(peer)
  if (obstruction === "other request before initialize") {
    tap.onRequest(peer, peer, otherRequest(1))
    tap.onResponse(peer, imageResult(1, true))
  }
  if (obstruction === "oversized initialize request") {
    tap.onRequest(
      peer,
      peer,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { oversized },
      }),
    )
  } else {
    tap.onRequest(peer, peer, initialize(1))
  }
  switch (obstruction) {
    case "matching error":
      tap.onResponse(
        peer,
        JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "rejected" } }),
      )
      break
    case "matching invalid response":
      tap.onResponse(peer, JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }))
      break
    case "provider protocol version mismatch":
      tap.onResponse(
        peer,
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 2 } }),
      )
      break
    case "owner replaced while pending":
      tap.onAccept(replacement)
      // The replacement can use the same id as the interrupted owner.
      tap.onRequest(replacement, replacement, initialize(1))
      tap.onResponse(replacement, imageResult(1, true))
      break
    case "owner vanished before response":
      tap.onResponse(undefined, imageResult(1, true))
      break
    case "late request from replaced peer":
      tap.onRequest(replacement, peer, otherRequest(2))
      break
    case "competing initialize":
      tap.onRequest(peer, peer, initialize(2))
      break
    case "request reusing the pending id":
      tap.onRequest(peer, peer, otherRequest(1))
      break
    case "oversized request while pending":
      tap.onRequest(
        peer,
        peer,
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/list", params: { oversized } }),
      )
      break
    case "oversized response while pending":
      tap.onResponse(
        peer,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: 1, _meta: { oversized } },
        }),
      )
      break
  }
  tap.onResponse(peer, imageResult(1, true))
  expect(tap.capabilities).toBeUndefined()
})

it.each([
  {
    name: "explicit false",
    caps: { promptCapabilities: { image: false } },
    expected: { protocolVersion: 1, image: false },
  },
  { name: "no prompt flag", caps: {}, expected: { protocolVersion: 1, image: false } },
  {
    name: "oversized initialize result",
    caps: { promptCapabilities: { image: true }, _meta: { synthetic: "☃".repeat(24_000) } },
    expected: undefined,
  },
])("keeps the cold relay working with $name", async ({ caps, expected }) => {
  const dir = scratch()
  const id = "cold"
  const socket = agentSocketPath(dir, id)
  const pid = await startSidecar(socket, id, dir, caps)
  const connections = createConnectionRegistry()
  vi.stubEnv("DC_DEPLOYMENT_DIR", dir)
  vi.stubEnv("AGENT_SIDECAR", "cursor")
  const conn = await connections.connect(id, "cursor", { cwd: dir, intent: "attachOnly" })
  cleanups.push(() => connections.close(id))
  const frames = framesOf(conn)
  const hosts = createAgentSessionRegistry({ connectionRegistry: connections })
  trackHost(hosts, id)
  expect(await hosts.getOrCreateHost(id)).toMatchObject({
    ok: true,
    entry: { host: { state: { sessionId: "fixture-saved" } } },
  })
  expect(conn.capabilities.image).toBe(expected === undefined)
  const result = frames.find((frame) => frame.dir === "in")
  expect(result?.parsed).toMatchObject({ result: { agentCapabilities: caps } })
  if (expected === undefined && result) {
    expect(result.raw.length).toBeLessThan(MAX_SIDECAR_CONTROL_BYTES)
    expect(Buffer.byteLength(result.raw)).toBeGreaterThan(MAX_SIDECAR_CONTROL_BYTES)
  }
  const pong = await probeAgentSocket(socket)
  expect(pong).toMatchObject({ state: "alive", info: { pid, hasOwner: true } })
  if (pong.state !== "alive") throw new Error("Expected a live sidecar")
  expect(pong.info?.initCapabilities).toEqual(expected)
})

type PongInfo = NonNullable<
  Extract<Awaited<ReturnType<typeof probeAgentSocket>>, { state: "alive" }>["info"]
>

async function pongServer(path: string, info: PongInfo) {
  const peers = new Set<net.Socket>()
  const pings: Array<string | number> = []
  const server = net.createServer((socket) => {
    peers.add(socket)
    socket.on("close", () => peers.delete(socket))
    socket.setEncoding("utf8")
    let buffer = ""
    socket.on("data", (data) => {
      buffer += data
      const end = buffer.indexOf("\n")
      if (end < 0) return
      const ping = decodePing(buffer.slice(0, end))
      if (ping === null) return
      pings.push(ping.id)
      socket.end(encodePong(ping.id, info))
    })
  })
  cleanups.push(async () => {
    for (const peer of peers) peer.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  server.listen(path)
  await once(server, "listening")
  return pings
}

const identity = {
  agentId: "adopt",
  cliKind: "cursor",
  pid: 42,
  startedAt: "2026-06-01T00:00:00.000Z",
}
const advertised = { ...identity, initCapabilities: versionedImage }

function attach(dir: string, intent?: "attachOnly") {
  return connectViaSidecar(
    identity.agentId,
    "cursor",
    { cwd: dir, intent },
    { DC_DEPLOYMENT_DIR: dir },
  )
}

it.each([
  { name: "old sidecar", metadata: identity, pid: 42 },
  { name: "different agent id", metadata: { ...advertised, agentId: "other" }, pid: 42 },
  { name: "different CLI kind", metadata: { ...advertised, cliKind: "other" }, pid: 42 },
  { name: "nonpositive PID", metadata: { ...advertised, pid: 0 }, pid: 0 },
  { name: "fractional PID", metadata: { ...advertised, pid: 1.5 }, pid: 1.5 },
  { name: "noncanonical timestamp", metadata: { ...advertised, startedAt: "2026-06-01" }, pid: 42 },
])(
  "attaches with the static default for $name and preserves PID reporting",
  async ({ metadata, pid }) => {
    const dir = scratch()
    const pings = await pongServer(agentSocketPath(dir, identity.agentId), metadata)
    const conn = await attach(dir, "attachOnly")
    cleanups.push(() => conn.close())
    expect(conn.pid).toBe(pid)
    expect(conn.capabilities.image).toBe(false)
    expect(pings).toHaveLength(1)
  },
)

it("does not derive the seed from the ready probe of a new launch", async () => {
  const dir = scratch()
  const socket = agentSocketPath(dir, identity.agentId)
  const launch = vi.spyOn(launcher, "launchOrAttachAgent").mockImplementationOnce(async () => {
    await pongServer(socket, advertised)
    return { kind: "launched", socket, unit: null }
  })
  const conn = await attach(dir)
  cleanups.push(() => conn.close())
  expect(launch).toHaveBeenCalledOnce()
  expect(conn.pid).toBe(identity.pid)
  expect(conn.capabilities.image).toBe(false)
})

it("does not relaunch when attachOnly finds an absent sidecar", async () => {
  const dir = scratch()
  const probe = vi.spyOn(sockets, "probeAgentSocket")
  await expect(attach(dir, "attachOnly")).rejects.toBeInstanceOf(RestoreSidecarGone)
  expect(probe).toHaveResolvedWith({ state: "absent" })
  expect(probe).toHaveBeenCalledOnce()
})

it("drops the seed after the socket is replaced within the same deployment directory", async () => {
  const dir = scratch()
  const path = agentSocketPath(dir, identity.agentId)
  const pings = await pongServer(path, advertised)
  const inode = statSync(path, { bigint: true }).ino
  const originalConnect = unix.connectUnix
  const connect = vi.spyOn(unix, "connectUnix").mockImplementationOnce(async (path) => {
    expect(pings).toHaveLength(1)
    renameSync(path, join(dir, "original.sock"))
    const replacementPings = await pongServer(path, advertised)
    expect(statSync(path, { bigint: true }).ino).not.toBe(inode)
    const transport = await originalConnect(path)
    expect(replacementPings).toHaveLength(0)
    return transport
  })
  const conn = await attach(dir, "attachOnly")
  cleanups.push(() => conn.close())
  expect(connect).toHaveBeenCalledExactlyOnceWith(path)
  expect(conn.pid).toBe(identity.pid)
  expect(conn.capabilities.image).toBe(false)
})

it("drops the seed after the deployment symlink changes target with the same socket inode", async () => {
  const dir = scratch()
  const first = join(dir, "first")
  const second = join(dir, "second")
  const deployment = join(dir, "deploy")
  mkdirSync(first)
  mkdirSync(second)
  symlinkSync(first, deployment)
  const originalPath = agentSocketPath(first, identity.agentId)
  const pings = await pongServer(originalPath, advertised)
  // Both names refer to the same bound inode; only the deployment target changes.
  linkSync(originalPath, agentSocketPath(second, identity.agentId))
  const path = agentSocketPath(deployment, identity.agentId)
  const old = statSync(path, { bigint: true })
  const originalConnect = unix.connectUnix
  const connect = vi.spyOn(unix, "connectUnix").mockImplementationOnce(async (path) => {
    expect(pings).toHaveLength(1)
    const nextLink = join(dir, "next")
    symlinkSync(second, nextLink)
    renameSync(nextLink, deployment)
    expect(statSync(deployment).ino).toBe(statSync(second).ino)
    expect(statSync(first).ino).not.toBe(statSync(second).ino)
    const current = statSync(path, { bigint: true })
    expect([current.dev, current.ino, current.ctimeNs, current.birthtimeNs]).toEqual([
      old.dev,
      old.ino,
      old.ctimeNs,
      old.birthtimeNs,
    ])
    return originalConnect(path)
  })
  const conn = await attach(deployment, "attachOnly")
  cleanups.push(() => conn.close())
  expect(connect).toHaveBeenCalledExactlyOnceWith(path)
  expect(conn.pid).toBe(identity.pid)
  expect(conn.capabilities.image).toBe(false)
  expect(pings).toHaveLength(1)
})

/** A controlled socket emitter specifies the exact data event boundaries. */
function probeChunks(chunks: (id: string | number) => Buffer[]) {
  const socket = new net.Socket()
  vi.mocked(net.connect).mockReturnValueOnce(socket)
  vi.spyOn(socket, "write").mockImplementation((data) => {
    const ping = decodePing(String(data))
    if (!ping) throw new Error("Expected a ping")
    for (const chunk of chunks(ping.id)) socket.emit("data", chunk)
    return true
  })
  const result = probeAgentSocket("fixture.sock")
  socket.emit("connect")
  expect(socket.destroyed).toBe(true)
  return result
}

it("reassembles a UTF-8 character split across socket data events", async () => {
  const info = { ...advertised, cwd: "/synthetic/☃" }
  const result = await probeChunks((id) => {
    const pong = Buffer.from(encodePong(id, info))
    const cut = pong.indexOf(Buffer.from("☃")) + 1
    return [pong.subarray(0, cut), pong.subarray(cut)]
  })
  expect(result).toEqual({ state: "alive", info })
})

it("caps a probe with no newline and retains its socket file", async () => {
  const dir = scratch()
  const path = agentSocketPath(dir, identity.agentId)
  const server = net.createServer((socket) => {
    socket.once("data", () => {
      socket.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "ECONNRESET") throw error
      })
      socket.end("☃".repeat(24_000))
    })
  })
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  server.listen(path)
  await once(server, "listening")
  const inode = statSync(path).ino
  expect(await probeAgentSocket(path)).toEqual({ state: "wedged" })
  expect(statSync(path).ino).toBe(inode)
})

it("accepts a complete matching pong before overflow in the same chunk", async () => {
  const result = await probeChunks((id) => {
    const prefix = Buffer.from(`${" ".repeat(1023)}\n`)
    const pong = Buffer.from(encodePong(id, advertised))
    const lastChunk = Buffer.concat([pong, Buffer.alloc(MAX_SIDECAR_CONTROL_BYTES - 1)])
    expect(prefix.length + lastChunk.length).toBeGreaterThan(MAX_SIDECAR_CONTROL_BYTES)
    return [prefix, lastChunk]
  })
  expect(result).toEqual({ state: "alive", info: advertised })
})

it.each([
  ["extra schema field", "2.0", { ...versionedImage, _meta: { leaked: privateValue } }, {}],
  ["wrong protocol version", "2.0", { ...versionedImage, protocolVersion: 2 }, {}],
  ["legacy envelope with invalid JSON-RPC version", "1.0", versionedImage, {}],
  ["legacy envelope with a method", "2.0", versionedImage, { method: "other" }],
  ["legacy envelope with an error", "2.0", versionedImage, { error: { code: -32600 } }],
] as const)(
  "keeps pong liveness and identity for %s without the capability",
  async (_case, jsonrpc, initCapabilities, extra) => {
    const result = await probeChunks((id) => [
      Buffer.from(
        `${JSON.stringify({
          jsonrpc,
          id,
          result: { alive: true, info: { ...identity, initCapabilities } },
          ...extra,
        })}\n`,
      ),
    ])
    expect(result).toEqual({ state: "alive", info: identity })
  },
)

async function openPeer(path: string) {
  const socket = net.connect(path)
  const reader = createInterface({ input: socket })
  const lines: string[] = []
  reader.on("line", (line) => lines.push(line))
  cleanups.push(() => {
    reader.close()
    socket.destroy()
  })
  await once(socket, "connect")
  return { socket, lines }
}

it.each([
  { scenario: "replacement peer", replaceOwner: true, requestId: 2, expected: undefined },
  { scenario: "same peer reusing the id", replaceOwner: false, requestId: 1, expected: undefined },
  {
    scenario: "same peer using a different id",
    replaceOwner: false,
    requestId: 2,
    expected: versionedImage,
  },
])(
  "relays both directions and resolves the initialize through $scenario",
  async ({ replaceOwner, requestId, expected }) => {
    const dir = scratch()
    const id = "pending"
    const path = agentSocketPath(dir, id)
    const initializeLine = initialize(1)
    const responseLine = imageResult(1, true)
    const requestLine = otherRequest(requestId)
    const acknowledgement = (line: string) =>
      JSON.stringify({ jsonrpc: "2.0", method: "_test/received", params: { line } })
    const script = `
import { createInterface } from "node:readline"
for await (const line of createInterface({ input: process.stdin })) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "_test/received", params: { line } }) + "\\n")
  if (JSON.parse(line).method !== "initialize") {
    process.stdout.write(${JSON.stringify(`${responseLine}\n`)})
  }
}
`
    await startSidecar(path, id, dir, {}, script)
    const first = await openPeer(path)
    first.socket.write(`${initializeLine}\n`)
    await vi.waitFor(() => expect(first.lines).toEqual([acknowledgement(initializeLine)]))
    const pending = await probeAgentSocket(path)
    expect(pending).toMatchObject({ state: "alive", info: { hasOwner: true } })
    expect(pending).not.toHaveProperty("info.initCapabilities")
    expect(first.socket.destroyed).toBe(false)
    const owner = replaceOwner ? await openPeer(path) : first
    const previous = owner.lines.slice()
    owner.socket.write(`${requestLine}\n`)
    await vi.waitFor(() =>
      expect(owner.lines).toEqual([...previous, acknowledgement(requestLine), responseLine]),
    )
    const pong = await probeAgentSocket(path)
    expect(pong).toMatchObject({ state: "alive", info: { hasOwner: true } })
    if (pong.state !== "alive") throw new Error("Expected a live sidecar")
    expect(pong.info?.initCapabilities).toEqual(expected)
  },
)
