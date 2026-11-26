import { setImmediate } from "node:timers/promises"
import { RPC_METHODS } from "@drive-coding/core/session"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import { createInMemoryAgentRegistry } from "../agents/registry.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import { createAgentEventBus } from "../session-host/agent-events.js"
import { registerEventsRoute } from "../session-host/http/events.js"
import { registerRpcRoute } from "../session-host/http/rpc.js"
import { createPatchesBroadcaster } from "../session-host/patches-broadcaster.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { createSessionHostFromConnection } from "../session-host/session-host.js"
import { registerMcpHttp } from "./http-mcp.js"

type PromptResult = Awaited<ReturnType<AcpClient["prompt"]>>

const promptEnded: PromptResult = { stopReason: "end_turn" }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const cwd = "/fixture"
const sessionA = "fixture-session-a"
const sessionB = "fixture-session-b"
const sessionC = "fixture-session-c"
const cleanups: Array<() => void | Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function makeFixture({ closeOnTurnEnd = true, initializeSession = true } = {}) {
  const provider = {
    prompt: vi.fn<AcpClient["prompt"]>().mockResolvedValue(promptEnded),
    cancel: vi.fn<AcpClient["cancel"]>().mockResolvedValue(undefined),
    newSession: vi.fn<AcpClient["newSession"]>().mockResolvedValue({ sessionId: sessionA }),
    loadSession: vi.fn<AcpClient["loadSession"]>().mockResolvedValue({}),
    capabilities: {},
  }
  const conn = {
    wire: { onLine: () => () => {}, write: () => true },
    onCrash: () => () => {},
  } as unknown as ProviderConnection
  const onTurnEnded = vi.fn()
  const onScheduleCloseOnTurnEnd = vi.fn()
  let callbacks!: AcpClientCallbacks
  const host = await createSessionHostFromConnection(conn, {
    closeOnTurnEnd,
    onTurnEnded,
    onScheduleCloseOnTurnEnd,
    _createAcpClient: async (_transport, handlers) => {
      callbacks = handlers
      return provider as unknown as AcpClient
    },
  })
  const broadcaster = createPatchesBroadcaster(host.patches)
  cleanups.push(async () => {
    await host.dispose()
    await broadcaster.close()
  })
  if (initializeSession) await host.newSession({ cwd })

  const registry = createInMemoryAgentRegistry()
  const { id: agentId } = await registry.create({ cwd, cliKind: "claude" })
  const sessionRegistry = {
    getHost: () => host,
    getOrCreateHost: async () => ({ ok: true, entry: { host, broadcaster } }),
    getEpoch: () => 0,
  } as unknown as AgentSessionRegistry
  const app = new Hono()
  registerMcpHttp(app, {
    registry,
    orchestrator: {} as AgentOrchestrator,
    agentSessionRegistry: sessionRegistry,
    eventBus: createAgentEventBus(),
    urlConfig: { port: 4000, host: "mcp.test" },
    env: { CLI_SPECS_FILE: "/nonexistent/fixture-cli-specs.jsonc" },
  })
  registerRpcRoute(app, sessionRegistry, registry)
  registerEventsRoute(app, sessionRegistry, {
    addConnection: vi.fn(),
    removeConnection: vi.fn(),
  } as unknown as ConnectionRegistry)

  const mcp = new Client({ name: "agent-cancel-fixture", version: "0.0.0" })
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL("http://mcp.test/api/mcp"), {
      fetch: async (input, init) =>
        app.request(input instanceof Request ? input : new Request(input, init)),
    }),
  )
  cleanups.push(() => mcp.close())

  async function tool(name: string, args: Record<string, unknown>) {
    const result = await mcp.callTool({ name, arguments: args })
    expect(result.isError).not.toBe(true)
    const content = result.content as Array<{ text: string }>
    const block = content[0]
    if (!block) throw new Error("MCP tool result has no content")
    return JSON.parse(block.text)
  }

  function beginPrompt(sessionId: string, text = "test prompt") {
    const completion = deferred<PromptResult>()
    provider.prompt.mockReturnValueOnce(completion.promise)
    const pending = host.prompt(sessionId, text)
    return { completion, pending }
  }

  function holdProviderCancel() {
    const entered = deferred<string>()
    const completion = deferred<void>()
    provider.cancel.mockImplementationOnce((sessionId) => {
      entered.resolve(sessionId)
      return completion.promise
    })
    return { entered: entered.promise, completion }
  }

  function expectNoTurnEffects(version: number) {
    expect(host.state.version).toBe(version)
    expect(provider.cancel).not.toHaveBeenCalled()
    expect(onTurnEnded).not.toHaveBeenCalled()
    expect(onScheduleCloseOnTurnEnd).not.toHaveBeenCalled()
  }

  function assistantUpdate(sessionId: string, text: string) {
    callbacks.onUpdate?.({
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    })
  }

  return {
    app,
    agentId,
    host,
    registry,
    provider,
    callbacks,
    onTurnEnded,
    onScheduleCloseOnTurnEnd,
    beginPrompt,
    holdProviderCancel,
    expectNoTurnEffects,
    assistantUpdate,
    cancel: () => tool("agent_cancel", { agentId }),
    send: (prompt: string) => tool("session_send", { agent: agentId, prompt, noWait: true }),
    state: () =>
      tool("session_state", { agent: agentId, fields: ["sessionId", "turnState", "messages"] }),
    rpcCancel: (sessionId: string, waitMs?: number) =>
      app.request(`/api/agents/${agentId}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: RPC_METHODS.cancel, params: { sessionId }, waitMs }),
      }),
  }
}

async function observe(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  const response = await fixture.app.request(`/api/agents/${fixture.agentId}/events?snapshot=meta`)
  expect(response.status).toBe(200)
  if (!response.body) throw new Error("Viewer response has no stream")
  const reader = response.body.getReader()
  cleanups.push(() => reader.cancel())
  const decoder = new TextDecoder()
  let buffer = ""
  return async function readFrame() {
    while (!buffer.includes("\n\n")) {
      const { value, done } = await reader.read()
      if (done) throw new Error("Viewer closed before receiving a complete frame")
      buffer += decoder.decode(value, { stream: true })
    }
    const boundary = buffer.indexOf("\n\n")
    const frame = buffer.slice(0, boundary)
    buffer = buffer.slice(boundary + 2)
    return frame
  }
}

describe("agent_cancel with an active SessionHost", () => {
  it("dispatches once for a held turn, retains the transcript, and accepts a follow-up turn", async () => {
    const fixture = await makeFixture({ closeOnTurnEnd: false })
    const firstTurn = deferred<PromptResult>()
    fixture.provider.prompt.mockReturnValueOnce(firstTurn.promise)
    expect(await fixture.send("first question")).toEqual({ running: true })
    fixture.assistantUpdate(sessionA, "partial reply")
    const cancellation = fixture.holdProviderCancel()
    const accepted = { ok: true, agentId: fixture.agentId, outcome: "cancel-requested" }
    expect(await fixture.cancel()).toEqual(accepted)
    expect(await cancellation.entered).toBe(sessionA)
    expect(await fixture.cancel()).toEqual(accepted)
    expect(fixture.provider.cancel.mock.calls).toEqual([[sessionA]])

    cancellation.completion.reject(new Error("best-effort provider cancel"))
    await setImmediate()
    firstTurn.resolve(promptEnded)
    await setImmediate()
    expect(await fixture.state()).toMatchObject({
      sessionId: sessionA,
      turnState: "idle",
      messages: [{ role: "user" }, { role: "assistant", segments: [{ text: "partial reply" }] }],
    })
    expect(await fixture.registry.get(fixture.agentId)).toMatchObject({ id: fixture.agentId })
    expect(fixture.onTurnEnded).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ stopReason: "cancelled", acpSessionId: sessionA }),
    )
    expect(await fixture.cancel()).toMatchObject({ outcome: "no-active-turn" })
    expect(await fixture.send("follow-up question")).toEqual({ running: true })
    expect(fixture.provider.prompt.mock.calls).toEqual([
      [sessionA, "first question"],
      [sessionA, "follow-up question"],
    ])
    expect(await fixture.state()).toMatchObject({
      sessionId: sessionA,
      messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }],
    })
  })

  it("returns no-active-turn while idle or disposed, without turn-end effects", async () => {
    const fixture = await makeFixture()
    const idleVersion = fixture.host.state.version
    expect(await fixture.cancel()).toMatchObject({ outcome: "no-active-turn" })
    fixture.expectNoTurnEffects(idleVersion)

    const active = fixture.beginPrompt(sessionA)
    await fixture.host.dispose()
    expect(fixture.host.state.turnState).not.toBe("idle")
    const disposedVersion = fixture.host.state.version
    expect(await fixture.cancel()).toMatchObject({ outcome: "no-active-turn" })
    fixture.expectNoTurnEffects(disposedVersion)
    active.completion.resolve(promptEnded)
    await active.pending
  })

  it("does not dispatch while the host has no session id", async () => {
    const fixture = await makeFixture({ initializeSession: false })
    const active = fixture.beginPrompt(sessionA)
    expect(fixture.host.state.sessionId).toBeNull()
    expect(fixture.host.state.turnState).not.toBe("idle")
    const version = fixture.host.state.version
    expect(await fixture.cancel()).toMatchObject({ outcome: "no-active-turn" })
    fixture.expectNoTurnEffects(version)
    active.completion.resolve(promptEnded)
    await active.pending
  })

  it("skips warm new before reset and while waiting for the provider, with the viewer reset intact", async () => {
    const fixture = await makeFixture()
    const turn = fixture.beginPrompt(sessionA)
    const nextFrame = await observe(fixture)
    expect(await nextFrame()).toContain("event: snapshot")
    const permission = fixture.callbacks.onRequestPermission?.({
      sessionId: sessionA,
      toolCall: { toolCallId: "fixture-tool" },
      options: [],
    })
    expect(fixture.host.state.pending.permission).not.toBeNull()

    const nextSession = deferred<Awaited<ReturnType<AcpClient["newSession"]>>>()
    const providerEntered = deferred<void>()
    fixture.provider.newSession.mockImplementationOnce(() => {
      providerEntered.resolve()
      return nextSession.promise
    })
    const transition = fixture.host.newSession({ cwd })
    expect(fixture.host.state.sessionId).toBe(sessionA)
    expect(fixture.host.state.turnState).not.toBe("idle")
    const before = fixture.host.state.version
    expect(fixture.host.cancelActiveTurn()).toBe("no-active-turn")
    fixture.expectNoTurnEffects(before)

    await permission
    await providerEntered.promise
    expect(fixture.host.state.sessionId).toBe("__drive_switching__")
    expect(fixture.host.state.turnState).not.toBe("idle")
    const beforeMcp = fixture.host.state.version
    expect(await fixture.cancel()).toMatchObject({ outcome: "no-active-turn" })
    fixture.expectNoTurnEffects(beforeMcp)
    let frames = ""
    while (!frames.includes('"_drive/reset"')) frames += await nextFrame()
    expect(frames).not.toContain('"turnState":"idle"')

    nextSession.resolve({ sessionId: sessionB })
    await transition
    turn.completion.resolve(promptEnded)
    await turn.pending
    expect(fixture.provider.cancel).not.toHaveBeenCalled()
    const nextTurn = fixture.beginPrompt(sessionB)
    expect(await fixture.cancel()).toMatchObject({ outcome: "cancel-requested" })
    expect(fixture.provider.cancel.mock.calls).toEqual([[sessionB]])
    nextTurn.completion.resolve(promptEnded)
    await nextTurn.pending
  })

  it("skips an active replay during load, then allows cancellation after rollback", async () => {
    const fixture = await makeFixture()
    const load = deferred<Awaited<ReturnType<AcpClient["loadSession"]>>>()
    fixture.provider.loadSession.mockReturnValueOnce(load.promise)
    const pending = fixture.host.loadSession({ cwd, sessionId: sessionB })
    expect(fixture.host.state.sessionId).toBe(sessionB)
    fixture.assistantUpdate(sessionB, "held replay")
    expect(fixture.host.state.turnState).not.toBe("idle")
    const before = fixture.host.state.version
    expect(await fixture.cancel()).toMatchObject({ outcome: "no-active-turn" })
    fixture.expectNoTurnEffects(before)

    const failed = expect(pending).rejects.toThrow("fixture load failed")
    load.reject(new Error("fixture load failed"))
    await failed
    expect(fixture.host.state.sessionId).toBe(sessionA)
    expect(fixture.host.state.turnState).toBe("idle")
    expect(fixture.provider.cancel).not.toHaveBeenCalled()
    const turn = fixture.beginPrompt(sessionA)
    expect(await fixture.cancel()).toMatchObject({ outcome: "cancel-requested" })
    expect(fixture.provider.cancel.mock.calls).toEqual([[sessionA]])
    turn.completion.resolve(promptEnded)
    await turn.pending
  })

  it("keeps the switch guard while a second transition is replaying", async () => {
    const fixture = await makeFixture()
    const loadB = deferred<Awaited<ReturnType<AcpClient["loadSession"]>>>()
    const loadC = deferred<Awaited<ReturnType<AcpClient["loadSession"]>>>()
    fixture.provider.loadSession
      .mockReturnValueOnce(loadB.promise)
      .mockReturnValueOnce(loadC.promise)
    const first = fixture.host.loadSession({ cwd, sessionId: sessionB })
    const second = fixture.host.loadSession({ cwd, sessionId: sessionC })
    loadB.resolve({})
    await first

    expect(fixture.host.state.sessionId).toBe(sessionC)
    fixture.assistantUpdate(sessionC, "second replay")
    expect(fixture.host.state.turnState).not.toBe("idle")
    const before = fixture.host.state.version
    expect(await fixture.cancel()).toMatchObject({ outcome: "no-active-turn" })
    fixture.expectNoTurnEffects(before)
    loadC.resolve({})
    await second

    const turn = fixture.beginPrompt(sessionC)
    expect(await fixture.cancel()).toMatchObject({ outcome: "cancel-requested" })
    expect(fixture.provider.cancel.mock.calls).toEqual([[sessionC]])
    turn.completion.resolve(promptEnded)
    await turn.pending
  })

  it("tracks MCP duplicates separately from RPC using a caller-specified session id", async () => {
    const fixture = await makeFixture({ closeOnTurnEnd: false })
    const turn = fixture.beginPrompt(sessionA)
    const firstRpc = fixture.holdProviderCancel()
    const mcp = fixture.holdProviderCancel()
    const waiting = fixture.rpcCancel("foreign-before", 30_000)
    expect(await firstRpc.entered).toBe("foreign-before")
    expect(await fixture.cancel()).toMatchObject({ outcome: "cancel-requested" })
    expect(fixture.provider.cancel.mock.calls).toEqual([["foreign-before"], [sessionA]])
    expect(await mcp.entered).toBe(sessionA)
    expect(await fixture.cancel()).toMatchObject({ outcome: "cancel-requested" })
    expect(fixture.provider.cancel.mock.calls).toEqual([["foreign-before"], [sessionA]])

    const laterRpc = await fixture.rpcCancel("foreign-after")
    expect(laterRpc.status).toBe(202)
    expect(fixture.provider.cancel.mock.calls).toEqual([
      ["foreign-before"],
      [sessionA],
      ["foreign-after"],
    ])
    firstRpc.completion.resolve()
    mcp.completion.resolve()
    const waited = await waiting
    expect(waited.status).toBe(200)
    expect(await waited.json()).toMatchObject({ ok: true, timedOut: false })
    turn.completion.resolve(promptEnded)
    await turn.pending
  })

  it("isolates late completion of a cancellation in session A from the new turn in session B", async () => {
    const fixture = await makeFixture()
    const first = fixture.beginPrompt(sessionA)
    const cancelA = fixture.holdProviderCancel()
    expect(await fixture.cancel()).toMatchObject({ outcome: "cancel-requested" })
    expect(await cancelA.entered).toBe(sessionA)

    fixture.provider.newSession.mockResolvedValueOnce({ sessionId: sessionB })
    await fixture.host.newSession({ cwd })
    const second = fixture.beginPrompt(sessionB)
    const before = fixture.host.state
    expect(before.turnState).not.toBe("idle")
    cancelA.completion.resolve()
    await setImmediate()
    expect(fixture.host.state.version).toBe(before.version)
    expect(fixture.host.state.turnState).toBe(before.turnState)
    expect(fixture.host.state.messages).toEqual(before.messages)
    expect(fixture.onTurnEnded).not.toHaveBeenCalled()
    expect(fixture.onScheduleCloseOnTurnEnd).not.toHaveBeenCalled()

    expect(await fixture.cancel()).toMatchObject({ outcome: "cancel-requested" })
    expect(fixture.provider.cancel.mock.calls).toEqual([[sessionA], [sessionB]])
    first.completion.resolve(promptEnded)
    second.completion.resolve(promptEnded)
    await Promise.all([first.pending, second.pending])
  })
})
