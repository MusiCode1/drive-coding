/**
 * http-viewer-detach.test.ts — HTTP viewer disconnect leaves host + pending queue alive.
 * Real ConnectionRegistry, real session-host HTTP routes, synthetic ACP client callbacks.
 */

import type { AcpClient } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { BridgeCrashInfo } from "@drive-coding/provider/spawn"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createConnectionRegistry } from "../src/acp/connection-registry.js"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import { setSelfBaseUrlForTests } from "../src/instances.js"
import { registerConnectionRoute } from "../src/session-host/http/connection.js"
import { registerSessionHostHttp } from "../src/session-host/http/index.js"
import { createAgentSessionRegistry } from "../src/session-host/registry.js"
import {
  createSessionHostFromConnection,
  type SessionHostFromConnOptions,
} from "../src/session-host/session-host.js"

type MockResponse = { status: number; body: ReadableStream<Uint8Array> | null }
type CapturedCallbacks = Parameters<NonNullable<SessionHostFromConnOptions["_createAcpClient"]>>[1]

const FIXTURE_PID = 90210
const CONN_A = "conn-viewer-a"
const CONN_B = "conn-viewer-b"
const CONN_C = "conn-viewer-c"

vi.mock("../src/acp/open-connection.js", () => ({
  openProviderConnection: vi.fn(async () => makeLiveConn()),
}))

function makeLiveConn(): ProviderConnection {
  return {
    wire: { onLine: vi.fn(() => () => {}), write: vi.fn(() => true) },
    capabilities: {} as ProviderConnection["capabilities"],
    onFrame: vi.fn(() => () => {}),
    turn: {
      isBusy: vi.fn(() => false),
      lastActivityAt: vi.fn(() => null),
      onChange: vi.fn(() => () => {}),
    },
    onCrash: vi.fn((_cb: (info: BridgeCrashInfo) => void) => () => {}),
    close: vi.fn().mockResolvedValue(undefined),
    pid: FIXTURE_PID,
  } as unknown as ProviderConnection
}

function makeMockAcpClient(): AcpClient {
  return {
    newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    conn: {} as AcpClient["conn"],
    capabilities: {},
    authMethods: [],
    deleteSession: vi.fn().mockResolvedValue(undefined),
    setSessionConfigOption: vi.fn().mockResolvedValue({}),
    setSessionMode: vi.fn().mockResolvedValue({}),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({}),
    close: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
  } as unknown as AcpClient
}

async function readSnapshotFrame(res: MockResponse): Promise<void> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    if (buffer.includes("event: snapshot") && buffer.includes("data: ")) return
  }
  throw new Error("no snapshot frame")
}

async function setup(kind: "permission" | "elicitation") {
  const connectionRegistry = createConnectionRegistry()
  const agentRegistry = createInMemoryAgentRegistry()
  const agent = await agentRegistry.create({ cliKind: "cursor", cwd: "/tmp/viewer-detach" })
  const agentId = agent.id
  await connectionRegistry.connect(agentId, "cursor", { cwd: "/tmp/viewer-detach" })
  let callbacks!: CapturedCallbacks
  const mockClient = makeMockAcpClient()
  const agentSessionRegistry = createAgentSessionRegistry({
    connectionRegistry,
    _createHostFn: async (conn, opts) =>
      createSessionHostFromConnection(conn, {
        ...opts,
        permissionTimeoutMs: 30_000,
        elicitationTimeoutMs: 30_000,
        _createAcpClient: async (_t, cbs) => {
          callbacks = cbs
          return mockClient
        },
      }),
  })
  const app = new Hono()
  registerSessionHostHttp(app, { agentSessionRegistry, connectionRegistry, agentRegistry })
  registerConnectionRoute(app, connectionRegistry)
  setSelfBaseUrlForTests("http://127.0.0.1:4055")
  const hostResult = await agentSessionRegistry.getOrCreateHost(agentId)
  if (!hostResult.ok) throw new Error(hostResult.reason)
  const host = hostResult.entry.host
  return { app, host, callbacks, connectionRegistry, kind, agentId }
}

async function req(app: Hono, path: string, init?: RequestInit): Promise<MockResponse> {
  return (await app.request(path, init)) as unknown as MockResponse
}

describe("HTTP viewer detach integration", () => {
  afterEach(() => {
    setSelfBaseUrlForTests(undefined)
    vi.clearAllMocks()
  })

  it.each(["permission", "elicitation"] as const)(
    "viewer A disconnects while pending %s; viewer B answers once",
    async (kind) => {
      const { app, host, callbacks, connectionRegistry, agentId } = await setup(kind)
      const permPromise =
        kind === "permission"
          ? callbacks.onRequestPermission!({
              sessionId: "s1",
              toolCall: { toolCallId: "tc1", name: "run", status: "pending" },
              options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }],
            } as never)
          : callbacks.onCreateElicitation!({
              sessionId: "s1",
              message: "input",
              requestedSchema: { type: "object", properties: {} },
            } as never)
      await new Promise((r) => setTimeout(r, 15))
      expect(host.state.pending[kind]).not.toBeNull()

      const resA = await req(app, `/api/agents/${agentId}/events`, {
        headers: { "Acp-Connection-Id": CONN_A },
      })
      expect(resA.status).toBe(200)
      const resB = await req(app, `/api/agents/${agentId}/events`, {
        headers: { "Acp-Connection-Id": CONN_B },
      })
      expect(resB.status).toBe(200)
      expect(connectionRegistry.listHttpConnectionIds(agentId)).toHaveLength(2)

      const delA = await req(app, `/api/agents/${agentId}/connection`, {
        method: "DELETE",
        headers: { "Acp-Connection-Id": CONN_A },
      })
      expect(delA.status).toBe(204)
      expect(connectionRegistry.listHttpConnectionIds(agentId)).toHaveLength(1)
      expect(connectionRegistry.getRuntimeInfo(agentId)?.pid).toBe(FIXTURE_PID)

      await readSnapshotFrame(resB)
      expect(host.state.pending[kind]).toMatchObject({ requestId: 0 })

      const reply = await req(app, `/api/agents/${agentId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Acp-Connection-Id": CONN_B },
        body: JSON.stringify({
          kind,
          requestId: 0,
          result:
            kind === "permission"
              ? { outcome: { outcome: "selected", optionId: "allow" } }
              : { action: "accept", content: {} },
        }),
      })
      expect(reply.status).toBe(200)
      const response = await permPromise
      if (kind === "permission") {
        expect((response as { outcome: { outcome: string } }).outcome.outcome).toBe("selected")
      } else {
        expect((response as { action: string }).action).toBe("accept")
      }
      expect(host.state.pending[kind]).toBeNull()
    },
  )

  it("last viewer disconnect leaves fixture pid and pending for a new viewer C", async () => {
    const { app, host, callbacks, connectionRegistry, agentId } = await setup("permission")
    const permPromise = callbacks.onRequestPermission!({
      sessionId: "s1",
      toolCall: { toolCallId: "tc1", name: "run", status: "pending" },
      options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }],
    } as never)
    await new Promise((r) => setTimeout(r, 15))

    const resA = await req(app, `/api/agents/${agentId}/events`, {
      headers: { "Acp-Connection-Id": CONN_A },
    })
    expect(resA.status).toBe(200)
    await req(app, `/api/agents/${agentId}/connection`, {
      method: "DELETE",
      headers: { "Acp-Connection-Id": CONN_A },
    })
    expect(connectionRegistry.listHttpConnectionIds(agentId)).toHaveLength(0)
    expect(connectionRegistry.getRuntimeInfo(agentId)?.pid).toBe(FIXTURE_PID)
    expect(host.state.pending.permission).not.toBeNull()

    const resC = await req(app, `/api/agents/${agentId}/events`, {
      headers: { "Acp-Connection-Id": CONN_C },
    })
    await readSnapshotFrame(resC)
    expect(host.state.pending.permission).toMatchObject({ requestId: 0 })

    await req(app, `/api/agents/${agentId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Acp-Connection-Id": CONN_C },
      body: JSON.stringify({
        kind: "permission",
        requestId: 0,
        result: { outcome: { outcome: "selected", optionId: "allow" } },
      }),
    })
    await permPromise
    expect(host.state.pending.permission).toBeNull()
  })
})
