import { fileURLToPath } from "node:url"
import {
  type SnapshotPayload,
  STREAM_ALIVE_EVENT,
  type WireSessionUpdate,
} from "@drive-coding/core/session"
import { createAcpClient } from "@drive-coding/provider/client"
import { invalidateCache } from "@drive-coding/provider/config"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createConnectionRegistry } from "../src/acp/connection-registry.js"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import type { AgentOrchestrator } from "../src/app/agent-orchestrator.js"
import { wireAgentEventDelivery } from "../src/delivery/agent-events-deliver.js"
import { registerMcpHttp } from "../src/delivery/http-mcp.js"
import { createAgentEventBus } from "../src/session-host/agent-events.js"
import {
  createTurnEndedEmitter,
  type TurnEndedInfo,
} from "../src/session-host/agent-events-turn.js"
import { registerEventsRoute } from "../src/session-host/http/events.js"
import { registerRpcRoute } from "../src/session-host/http/rpc.js"
import { createAgentSessionRegistry } from "../src/session-host/registry.js"
import { createSessionHostFromConnection } from "../src/session-host/session-host.js"

const fixture = fileURLToPath(new URL("./fixtures/contract2-b1-acp-v1.mjs", import.meta.url))
const sessionId = "b1-fixture-session"
const replyText = "B1 fixture reply"
const rejectMessage = "Fixture prompt rejected"
const rejectCode = -32001
const replyMessage = expect.objectContaining({
  role: "assistant",
  segments: expect.arrayContaining([expect.objectContaining({ text: replyText })]),
})
const stopReasons = ["end_turn", "cancelled", "refusal", "max_tokens", "max_turn_requests"] as const
const deadline = 8_000
const cleanup: Array<() => void | Promise<void>> = []

afterEach(async () => {
  const errors: unknown[] = []
  try {
    while (cleanup.length > 0) {
      try {
        await cleanup.pop()?.()
      } catch (error) {
        errors.push(error)
      }
    }
  } finally {
    vi.unstubAllEnvs()
    invalidateCache()
  }
  if (errors.length > 0) throw new AggregateError(errors, "Failed to close fixture resources")
})

type Frame = { event: string; data: string }
type Notification = { params: { sessionId: string; update: WireSessionUpdate } }

function readSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  cleanup.push(() => reader.cancel())
  const decoder = new TextDecoder()
  let buffer = ""
  return async function next(): Promise<Frame> {
    for (;;) {
      const separator = buffer.indexOf("\n\n")
      if (separator === -1) {
        const read = await reader.read()
        if (read.done) throw new Error("SSE stream ended before the expected frame")
        buffer += decoder.decode(read.value, { stream: true })
        continue
      }
      const text = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      const event = /^event: (.+)$/m.exec(text)?.[1]
      if (event === STREAM_ALIVE_EVENT) continue
      const data = /^data: (.*)$/m.exec(text)?.[1]
      if (!event || data === undefined) throw new Error("Invalid SSE frame")
      return { event, data }
    }
  }
}

async function nextUpdate(next: () => Promise<Frame>, matches: (u: WireSessionUpdate) => boolean) {
  for (;;) {
    const frame = await next()
    if (frame.event !== "update") continue
    const batch = JSON.parse(frame.data) as Notification[]
    const selected = batch.find(({ params }) => matches(params.update))
    if (selected) {
      expect(selected.params.sessionId).toBe(sessionId)
      return selected.params.update
    }
  }
}

function isIdle(update: WireSessionUpdate): boolean {
  return update.sessionUpdate === "state_update" && update.state === "idle"
}

const unusedAgentOperation = async (): Promise<never> => {
  throw new Error("Unexpected agent orchestration in the prompt harness")
}
const orchestrator: AgentOrchestrator = {
  createAndSpawn: unusedAgentOperation,
  deleteAndKill: unusedAgentOperation,
  deleteAllAndKill: unusedAgentOperation,
  getBridgePort: () => 0,
}

type Point = "rpc" | "mcp"
type WireMessage = {
  id?: number | string
  method?: string
  result?: unknown
  error?: unknown
}

async function setup(point: Point, holdCancel = false) {
  const cliSpecsFile = `${fixture}.jsonc`
  vi.stubEnv("CLI_SPECS_FILE", cliSpecsFile)
  vi.stubEnv("AGENT_SIDECAR", "")
  vi.stubEnv("OPENCODE_ARGS", undefined)
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
  const registry = createInMemoryAgentRegistry()
  const { id: agentId, cwd } = await registry.create({ cliKind: "opencode", cwd: process.cwd() })
  const connections = createConnectionRegistry()
  cleanup.push(() => connections.close(agentId))
  const conn = await connections.connect(agentId, "opencode", {
    cwd,
    shapeEnv: () => ({ B1_FIXTURE_REPLACE_REASON: process.env.B1_FIXTURE_REPLACE_REASON }),
  })
  const wire: { dir: "in" | "out"; message: WireMessage }[] = []
  cleanup.push(conn.onFrame(({ dir, raw }) => wire.push({ dir, message: JSON.parse(raw) })))
  async function wireMessage(dir: "in" | "out", matches: (message: WireMessage) => boolean) {
    return vi.waitFor(
      () => {
        const observed = wire.find((frame) => frame.dir === dir && matches(frame.message))
        if (!observed) throw new Error(`Missing ACP ${dir} frame`)
        return observed.message
      },
      { timeout: deadline },
    )
  }

  let releaseCancel = () => {}
  const cancelGate = new Promise<void>((resolve) => {
    releaseCancel = resolve
  })
  const eventBus = createAgentEventBus()
  const emitTurnEnded = createTurnEndedEmitter(eventBus)
  const ended: { agentId: string; info: TurnEndedInfo }[] = []
  const sessions = createAgentSessionRegistry({
    connectionRegistry: connections,
    onTurnEnded(id, info) {
      ended.push({ agentId: id, info })
      emitTurnEnded(id, info)
    },
    _createHostFn: (connection, opts) =>
      createSessionHostFromConnection(connection, {
        ...opts,
        initTimeoutMs: deadline,
        _createAcpClient: async (...args) => {
          const client = await createAcpClient(...args)
          if (!holdCancel) return client
          const sendCancel = client.cancel
          client.cancel = async (id) => {
            await sendCancel(id)
            await cancelGate
          }
          return client
        },
      }),
  })
  cleanup.push(async () => {
    releaseCancel()
    try {
      await sessions.getHost(agentId)?.dispose()
    } finally {
      sessions.unregisterHost(agentId)
      sessions.stop()
    }
  })
  cleanup.push(wireAgentEventDelivery({ eventBus, agentSessionRegistry: sessions }))

  const app = new Hono()
  registerRpcRoute(app, sessions, registry)
  registerEventsRoute(app, sessions, connections)
  let mcp: Client | undefined
  if (point === "mcp") {
    registerMcpHttp(app, {
      registry,
      orchestrator,
      agentSessionRegistry: sessions,
      eventBus,
      env: { CLI_SPECS_FILE: cliSpecsFile },
      urlConfig: { host: "fixture.invalid", port: 80 },
    })
    const client = new Client({ name: "b1-fixture", version: "1.0.0" })
    cleanup.push(() => client.close())
    const fetch = (input: string | URL | Request, init?: RequestInit) =>
      app.request(input instanceof Request ? input : new Request(input, init))
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://fixture.invalid/api/mcp"), {
        fetch: fetch as typeof globalThis.fetch,
      }),
      { timeout: deadline },
    )
    mcp = client
  }

  async function rpc(method: string, params: object, waitMs?: number) {
    const response = (await app.request(`/api/agents/${agentId}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params, waitMs }),
      signal: AbortSignal.timeout(deadline),
    })) as { status: number; json(): Promise<unknown> }
    return { status: response.status, body: await response.json() }
  }

  async function openViewer() {
    const response = (await app.request(`/api/agents/${agentId}/events`, {
      signal: AbortSignal.timeout(deadline),
    })) as { status: number; body: ReadableStream<Uint8Array> | null }
    expect(response.status).toBe(200)
    if (!response.body) throw new Error("Missing viewer SSE body")
    const next = readSse(response.body)
    const initial = await next()
    expect(initial.event).toBe("snapshot")
    const snapshot = JSON.parse(initial.data) as SnapshotPayload
    expect(snapshot.sessionId).toBe(sessionId)
    return { next, snapshot }
  }

  return {
    agentId,
    ended,
    openViewer,
    releaseCancel,
    promptRequest: () => wireMessage("out", (message) => message.method === "session/prompt"),
    cancelRequest: () => wireMessage("out", (message) => message.method === "session/cancel"),
    answerTo: (id: WireMessage["id"]) => wireMessage("in", (message) => message.id === id),
    releasePrompt: () =>
      conn.wire.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "_test/complete", params: { sessionId } })}\n`,
      ),
    cancel: () => rpc("session/cancel", { sessionId }, deadline / 2),
    async send(scenario: string, mode: "wait" | "no-wait" | "timeout" = "wait") {
      const prompt = `[b1:${scenario}]`
      if (mcp) {
        const result = CallToolResultSchema.parse(
          await mcp.callTool(
            {
              name: "session_send",
              arguments: {
                agent: agentId,
                prompt,
                ...(mode === "no-wait" ? { noWait: true } : {}),
                ...(mode === "timeout" ? { timeoutSec: 0.01 } : {}),
              },
            },
            undefined,
            { timeout: deadline },
          ),
        )
        expect(result.isError).not.toBe(true)
        const block = result.content.find((entry) => entry.type === "text")
        if (block?.type !== "text") throw new Error("Missing MCP result text")
        return { body: JSON.parse(block.text) as unknown }
      }
      return rpc(
        "session/prompt",
        { sessionId, content: prompt },
        mode === "no-wait" ? undefined : mode === "timeout" ? 5 : deadline / 2,
      )
    },
  }
}

type Harness = Awaited<ReturnType<typeof setup>>

function expectCompletion(
  point: Point,
  response: Awaited<ReturnType<Harness["send"]>>,
  reason: string,
) {
  const failed = reason !== "end_turn" && reason !== "cancelled"
  if (point === "rpc") {
    expect(response).toEqual({
      status: 200,
      body: {
        version: expect.any(Number),
        ok: true,
        timedOut: false,
        stopReason: reason,
        messagesSince: expect.arrayContaining([replyMessage]),
      },
    })
  } else {
    expect(response.body).toEqual({
      stopReason: reason,
      lastTurnError: failed ? { message: reason, at: expect.any(Number) } : null,
      text: replyText,
      messagesSince: expect.arrayContaining([replyMessage]),
    })
  }
}

async function expectObserver(harness: Harness, next: () => Promise<Frame>, stopReason: string) {
  const idle = await nextUpdate(next, isIdle)
  expect(idle.stopReason).toBe(stopReason)
  const failed = stopReason !== "end_turn" && stopReason !== "cancelled"
  const meta = idle._meta as Record<string, unknown> | undefined
  const errorAt = meta?.["_drive/at"]
  if (failed) expect(errorAt).toEqual(expect.any(Number))
  else expect(errorAt).toBeUndefined()
  const event = await nextUpdate(next, (update) => update.method === "_drive/agent_event")
  expect(event).toMatchObject({
    sessionUpdate: "_drive/ext_notification",
    params: {
      kind: "turn-ended",
      agentId: harness.agentId,
      stopReason,
      lastTurnError: failed ? { message: stopReason } : null,
    },
  })
  const { snapshot } = await harness.openViewer()
  expect(snapshot.updates.find(isIdle)).toEqual(idle)
  expect(harness.ended).toEqual([
    {
      agentId: harness.agentId,
      info: expect.objectContaining({
        acpSessionId: sessionId,
        stopReason,
        lastTurnError: failed ? { message: stopReason, at: errorAt } : null,
      }),
    },
  ])
}

describe.each(["rpc", "mcp"] as const)("%s over ACP v1", (point) => {
  it.each(stopReasons)(
    "publishes exact %s on the caller, viewer, snapshot and event",
    async (reason) => {
      const harness = await setup(point, reason === "cancelled")
      const { next } = await harness.openViewer()
      const caller = harness.send(reason)
      const request = await harness.promptRequest()
      expect(request.id).toBeDefined()
      let cancel: ReturnType<Harness["cancel"]> | undefined
      if (reason === "cancelled") {
        cancel = harness.cancel()
        await harness.cancelRequest()
      }
      try {
        expectCompletion(point, await caller, reason)
        expect(await harness.answerTo(request.id)).toMatchObject({
          id: request.id,
          result: { stopReason: reason },
        })
        await expectObserver(harness, next, reason)
      } finally {
        harness.releaseCancel()
        if (cancel) expect((await cancel).body).toMatchObject({ ok: true, timedOut: false })
      }
    },
    20_000,
  )

  it.each(["no-wait", "timeout"] as const)(
    "preserves %s and lets the fixture finish afterwards",
    async (mode) => {
      const harness = await setup(point)
      const { next } = await harness.openViewer()
      const result = await harness.send("hold", mode)
      if (point === "mcp") {
        expect(result.body).toEqual({ running: true })
      } else if (mode === "no-wait") {
        expect(result).toEqual({ status: 202, body: { version: expect.any(Number) } })
      } else {
        expect(result).toEqual({
          status: 200,
          body: { version: expect.any(Number), ok: false, timedOut: true },
        })
      }
      await harness.promptRequest()
      expect(harness.ended).toEqual([])
      expect(harness.releasePrompt()).toBe(true)
      await expectObserver(harness, next, "end_turn")
    },
    20_000,
  )

  it("preserves the rejection envelope for a JSON-RPC error", async () => {
    const harness = await setup(point)
    const { next } = await harness.openViewer()
    const response = await harness.send("reject")
    if (point === "rpc") {
      expect(response).toEqual({
        status: 200,
        body: {
          version: expect.any(Number),
          ok: false,
          timedOut: false,
          error: { code: rejectCode, message: rejectMessage },
          messagesSince: expect.arrayContaining([replyMessage]),
        },
      })
    } else {
      expect(response.body).toEqual({
        stopReason: rejectMessage,
        lastTurnError: { message: rejectMessage, at: expect.any(Number) },
        text: replyText,
        messagesSince: expect.arrayContaining([replyMessage]),
      })
    }
    const request = await harness.promptRequest()
    expect(request.id).toBeDefined()
    const wireError = await harness.answerTo(request.id)
    expect(wireError.error).toEqual({ code: rejectCode, message: rejectMessage })
    expect(wireError).not.toHaveProperty("result")
    await expectObserver(harness, next, rejectMessage)
  }, 20_000)
})

it("preserves local cancellation through a late chunk and a different wire completion", async () => {
  const harness = await setup("rpc")
  const { next } = await harness.openViewer()
  const caller = harness.send("late-cancel")
  const request = await harness.promptRequest()
  expect(request.id).toBeDefined()
  expect((await harness.cancel()).body).toMatchObject({ ok: true, timedOut: false })
  await expectObserver(harness, next, "cancelled")
  expect(harness.releasePrompt()).toBe(true)
  expect(await harness.answerTo(request.id)).toMatchObject({ result: { stopReason: "end_turn" } })
  expectCompletion("rpc", await caller, "cancelled")
  const tail = await nextUpdate(next, (update) =>
    JSON.stringify(update).includes(" after local cancel"),
  )
  expect(tail.sessionUpdate).toBe("agent_message_chunk")
  expect((await nextUpdate(next, isIdle)).stopReason).toBe("cancelled")
  expect(harness.ended).toHaveLength(1)
  const { snapshot } = await harness.openViewer()
  expect(snapshot.updates.find(isIdle)?.stopReason).toBe("cancelled")
}, 20_000)
