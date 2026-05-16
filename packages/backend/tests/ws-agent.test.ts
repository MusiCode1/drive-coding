import type { CacheStore } from "@drive-coding/core"
import type { ServerWebSocket } from "bun"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentOrchestrator } from "../src/app/agent-orchestrator"
import type { AgentSession } from "../src/app/agent-session"
import { type AgentWsData, createAgentWsHandler } from "../src/delivery/ws-agent"
import type { VoiceRegistries } from "../src/voice/providers"

// ─── Mocks ────────────────────────────────────────────────────────────

function makeSession(overrides?: Partial<AgentSession>): AgentSession & {
  subscribers: Array<(msg: unknown) => void>
} {
  const subscribers: Array<(msg: unknown) => void> = []
  return {
    agentId: "agent-1",
    subscribe(cb) {
      subscribers.push(cb)
      return () => {
        const idx = subscribers.indexOf(cb)
        if (idx >= 0) subscribers.splice(idx, 1)
      }
    },
    sendPrompt: vi.fn(async () => {}),
    sendAudioPrompt: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    subscribers,
    ...overrides,
  } as unknown as AgentSession & { subscribers: Array<(msg: unknown) => void> }
}

function makeWs(agentId: string): {
  ws: ServerWebSocket<AgentWsData>
  sent: string[]
  closeArgs: Array<[number?, string?]>
} {
  const sent: string[] = []
  const closeArgs: Array<[number?, string?]> = []
  const ws = {
    data: { kind: "agent" as const, agentId },
    send: vi.fn((d: unknown) => {
      sent.push(typeof d === "string" ? d : String(d))
    }),
    close: vi.fn((code?: number, reason?: string) => {
      closeArgs.push([code, reason])
    }),
  } as unknown as ServerWebSocket<AgentWsData>
  return { ws, sent, closeArgs }
}

const mockRegistries = {} as VoiceRegistries
const mockCache = {
  async init() {},
  async get() {
    return null
  },
  async set() {},
} as unknown as CacheStore

// ─── Tests ────────────────────────────────────────────────────────────

describe("createAgentWsHandler — open()", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("known agent → sends 'connected' message + subscribes", () => {
    const session = makeSession({ agentId: "agent-X" })
    const orchestrator = {
      getSession: vi.fn(() => session),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const { ws, sent } = makeWs("agent-X")
    handler.websocket.open?.(ws)

    expect(sent).toHaveLength(1)
    const parsed = JSON.parse(sent[0] ?? "")
    expect(parsed).toEqual({ type: "connected", agentId: "agent-X" })
    expect(session.subscribers).toHaveLength(1)
  })

  it("unknown agent → sends error AGENT_NOT_FOUND + closes WS", () => {
    const orchestrator = {
      getSession: vi.fn(() => null),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const { ws, sent, closeArgs } = makeWs("ghost")
    handler.websocket.open?.(ws)

    const errMsg = JSON.parse(sent[0] ?? "")
    expect(errMsg.type).toBe("error")
    expect(errMsg.code).toBe("AGENT_NOT_FOUND")
    expect(closeArgs).toHaveLength(1)
    expect(closeArgs[0]?.[0]).toBe(1008)
  })
})

describe("createAgentWsHandler — message()", () => {
  it("invalid JSON → sends INVALID_JSON error", async () => {
    const session = makeSession()
    const orchestrator = {
      getSession: vi.fn(() => session),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const { ws, sent } = makeWs("agent-1")
    await handler.websocket.message?.(ws, "not-json{{{")

    const parsed = JSON.parse(sent.at(-1) ?? "")
    expect(parsed.type).toBe("error")
    expect(parsed.code).toBe("INVALID_JSON")
  })

  it("unknown message type → sends INVALID_MSG error", async () => {
    const session = makeSession()
    const orchestrator = {
      getSession: vi.fn(() => session),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const { ws, sent } = makeWs("agent-1")
    await handler.websocket.message?.(ws, JSON.stringify({ type: "subscribe" }))

    const parsed = JSON.parse(sent.at(-1) ?? "")
    expect(parsed.type).toBe("error")
    expect(parsed.code).toBe("INVALID_MSG")
  })

  it("ping → pong with serverTime", async () => {
    const session = makeSession()
    const orchestrator = {
      getSession: vi.fn(() => session),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const { ws, sent } = makeWs("agent-1")
    await handler.websocket.message?.(ws, JSON.stringify({ type: "ping" }))

    const parsed = JSON.parse(sent.at(-1) ?? "")
    expect(parsed.type).toBe("pong")
    expect(parsed.echoOf).toBe("ping")
    expect(typeof parsed.serverTime).toBe("number")
  })

  it("prompt → calls session.sendPrompt with text", async () => {
    const session = makeSession()
    const orchestrator = {
      getSession: vi.fn(() => session),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const { ws } = makeWs("agent-1")
    await handler.websocket.message?.(ws, JSON.stringify({ type: "prompt", text: "hello" }))

    // sendPrompt is fire-and-forget so we wait for microtasks
    await new Promise((r) => setImmediate(r))

    expect(session.sendPrompt).toHaveBeenCalledWith("hello")
  })

  it("cancel → calls session.cancel", async () => {
    const session = makeSession()
    const orchestrator = {
      getSession: vi.fn(() => session),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const { ws } = makeWs("agent-1")
    await handler.websocket.message?.(ws, JSON.stringify({ type: "cancel" }))

    expect(session.cancel).toHaveBeenCalledOnce()
  })

  it("audio → decodes base64 + calls session.sendAudioPrompt", async () => {
    const session = makeSession()
    const orchestrator = {
      getSession: vi.fn(() => session),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const { ws } = makeWs("agent-1")
    const audioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x44])
    const audioBase64 = Buffer.from(audioBytes).toString("base64")

    await handler.websocket.message?.(
      ws,
      JSON.stringify({
        type: "audio",
        agentId: "agent-1",
        audioBase64,
        mimeType: "audio/webm",
      }),
    )
    await new Promise((r) => setImmediate(r))

    expect(session.sendAudioPrompt).toHaveBeenCalledOnce()
    const callArgs = (session.sendAudioPrompt as ReturnType<typeof vi.fn>).mock.calls[0] ?? []
    // First arg: Uint8Array with same bytes
    const passedBytes = callArgs[0] as Uint8Array
    expect(Array.from(passedBytes)).toEqual(Array.from(audioBytes))
    expect(callArgs[1]).toBe("audio/webm")
  })

  it("agent removed mid-session → message responds AGENT_NOT_FOUND", async () => {
    let session: AgentSession | null = makeSession()
    const orchestrator = {
      getSession: vi.fn(() => session),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })
    const { ws, sent } = makeWs("agent-1")

    // Open OK
    handler.websocket.open?.(ws)

    // Now remove the agent
    session = null

    await handler.websocket.message?.(ws, JSON.stringify({ type: "prompt", text: "hi" }))

    const lastErr = JSON.parse(sent.at(-1) ?? "")
    expect(lastErr.type).toBe("error")
    expect(lastErr.code).toBe("AGENT_NOT_FOUND")
  })
})

describe("createAgentWsHandler — broadcasts", () => {
  it("session broadcasts → forwarded to ws.send", () => {
    const session = makeSession()
    const orchestrator = {
      getSession: vi.fn(() => session),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const { ws, sent } = makeWs("agent-1")
    handler.websocket.open?.(ws)

    // First send was 'connected'. Now simulate a broadcast.
    session.subscribers[0]?.({ type: "thinking" })
    session.subscribers[0]?.({
      type: "text_chunk",
      kind: "message",
      text: "Hello world",
    })

    // sent[0] = connected, sent[1] = thinking, sent[2] = text_chunk
    expect(sent).toHaveLength(3)
    expect(JSON.parse(sent[1] ?? "").type).toBe("thinking")
    expect(JSON.parse(sent[2] ?? "").type).toBe("text_chunk")
  })

  it("close() → unsubscribes the session subscriber", () => {
    const session = makeSession()
    const orchestrator = {
      getSession: vi.fn(() => session),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const { ws } = makeWs("agent-1")
    handler.websocket.open?.(ws)
    expect(session.subscribers).toHaveLength(1)

    handler.websocket.close?.(ws, 1000, "bye")

    expect(session.subscribers).toHaveLength(0)
  })
})

describe("createAgentWsHandler — tryUpgrade", () => {
  function makeMockServer() {
    return {
      upgrade: vi.fn(() => true),
    } as unknown as ReturnType<typeof Bun.serve>
  }

  it("URL /ws/agent/abc → calls server.upgrade with agentId='abc'", () => {
    const orchestrator = {
      getSession: vi.fn(() => makeSession()),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const server = makeMockServer()
    const req = new Request("http://x/ws/agent/abc")
    const res = handler.tryUpgrade(req, server)

    expect(server.upgrade).toHaveBeenCalledWith(req, {
      data: { kind: "agent", agentId: "abc" },
    })
    expect(res).toBeUndefined()
  })

  it("URL not matching pattern → returns undefined (no upgrade)", () => {
    const orchestrator = {
      getSession: vi.fn(() => makeSession()),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const server = makeMockServer()
    const req = new Request("http://x/api/agents")
    const res = handler.tryUpgrade(req, server)

    expect(res).toBeUndefined()
    expect(server.upgrade).not.toHaveBeenCalled()
  })

  it("upgrade returns false → returns 426 Response", () => {
    const orchestrator = {
      getSession: vi.fn(() => makeSession()),
    } as unknown as AgentOrchestrator
    const handler = createAgentWsHandler({
      orchestrator,
      registries: mockRegistries,
      cache: mockCache,
    })

    const server = {
      upgrade: vi.fn(() => false),
    } as unknown as ReturnType<typeof Bun.serve>

    const req = new Request("http://x/ws/agent/abc")
    const res = handler.tryUpgrade(req, server)

    expect(res).toBeInstanceOf(Response)
    expect(res?.status).toBe(426)
  })
})
