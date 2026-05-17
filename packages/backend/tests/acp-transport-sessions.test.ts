/**
 * Phase 1 — TDD tests for listSessionsFromBridge + createAcpWsLoadTransport
 *
 * These extend acp-transport.ts with session history support:
 *   - listSessionsFromBridge: calls ACP session/list, returns SessionInfo[]
 *   - createAcpWsLoadTransport: calls session/load (not session/new), collects history
 */

import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ─── Mock WebSocket ───────────────────────────────────────────────────────────

type MockOptions = {
  openError?: boolean
  skipConnected?: boolean
  // initialize
  initializeResult?: unknown
  // session/list
  listSessionsResult?: { sessions: unknown[] }
  listSessionsError?: { code: number; message: string }
  // session/load
  loadSessionResult?: unknown
  loadSessionError?: { code: number; message: string }
  loadSessionNotifications?: unknown[]
  // session/new (for createAcpWsTransport compat)
  newSessionResult?: unknown
  // session/prompt
  promptResult?: unknown
  promptNotifications?: unknown[]
}

let MOCK_OPTS: MockOptions = {}
const mockInstances: MockWS[] = []

class MockWS extends EventEmitter {
  static OPEN = 1 as const
  static CLOSED = 3 as const
  readonly OPEN = 1
  readonly CLOSED = 3
  readyState = 0
  url: string
  terminate = vi.fn(() => {
    this.readyState = this.CLOSED
  })
  close = vi.fn((_code?: number, _reason?: string) => {
    this.readyState = this.CLOSED
  })
  sentMessages: string[] = []

  constructor(url: string) {
    super()
    this.url = url
    mockInstances.push(this)
    queueMicrotask(() => {
      if (MOCK_OPTS.openError) {
        this.emit("error", new Error("connection refused"))
        return
      }
      this.readyState = this.OPEN
      this.emit("open")
      if (!MOCK_OPTS.skipConnected) {
        queueMicrotask(() =>
          this.emit(
            "message",
            Buffer.from('{"type":"connected","clientId":"mock-client"}', "utf8"),
          ),
        )
      }
    })
  }

  send(data: string) {
    this.sentMessages.push(data)
    let parsed: { id?: number; method?: string; params?: unknown }
    try {
      parsed = JSON.parse(data.trim())
    } catch {
      return
    }

    if (parsed.method === "initialize") {
      const result = MOCK_OPTS.initializeResult ?? {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: "mock-agent", version: "0.0.1" },
      }
      this.respond(parsed.id ?? 0, result)
      return
    }

    if (parsed.method === "session/list") {
      if (MOCK_OPTS.listSessionsError) {
        this.respondError(parsed.id ?? 0, MOCK_OPTS.listSessionsError)
        return
      }
      const result = MOCK_OPTS.listSessionsResult ?? { sessions: [] }
      this.respond(parsed.id ?? 0, result)
      return
    }

    if (parsed.method === "session/load") {
      if (MOCK_OPTS.loadSessionError) {
        this.respondError(parsed.id ?? 0, MOCK_OPTS.loadSessionError)
        return
      }
      // Emit history notifications first
      for (const note of MOCK_OPTS.loadSessionNotifications ?? []) {
        const frame = `${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: note })}\n`
        queueMicrotask(() => this.emit("message", Buffer.from(frame, "utf8")))
      }
      const result = MOCK_OPTS.loadSessionResult ?? {
        sessionId: "sess-loaded-1",
      }
      this.respond(parsed.id ?? 0, result)
      return
    }

    if (parsed.method === "session/new") {
      const result = MOCK_OPTS.newSessionResult ?? { sessionId: "sess-new-1" }
      this.respond(parsed.id ?? 0, result)
      return
    }

    if (parsed.method === "session/prompt") {
      for (const note of MOCK_OPTS.promptNotifications ?? []) {
        const frame = `${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: note })}\n`
        queueMicrotask(() => this.emit("message", Buffer.from(frame, "utf8")))
      }
      const result = MOCK_OPTS.promptResult ?? { stopReason: "end_turn" }
      this.respond(parsed.id ?? 0, result)
      return
    }

    if (parsed.method === "session/cancel") {
      this.respond(parsed.id ?? 0, null)
      return
    }
  }

  private respond(id: number, result: unknown) {
    queueMicrotask(() => {
      const frame = `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`
      this.emit("message", Buffer.from(frame, "utf8"))
    })
  }

  private respondError(id: number, error: { code: number; message: string; data?: unknown }) {
    queueMicrotask(() => {
      const frame = `${JSON.stringify({ jsonrpc: "2.0", id, error })}\n`
      this.emit("message", Buffer.from(frame, "utf8"))
    })
  }
}

vi.mock("ws", () => ({
  WebSocket: MockWS,
  default: MockWS,
}))

// Import AFTER mock
const { listSessionsFromBridge, createAcpWsLoadTransport } = await import(
  "../src/acp/acp-transport.js"
)

function reset(opts: MockOptions = {}) {
  MOCK_OPTS = opts
  mockInstances.length = 0
}

// ─── listSessionsFromBridge ──────────────────────────────────────────────────

describe("listSessionsFromBridge", () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    reset()
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it("returns sessions from session/list response", async () => {
    reset({
      listSessionsResult: {
        sessions: [
          { sessionId: "s1", cwd: "/proj", title: "My session", updatedAt: "2026-01-01T00:00:00Z" },
          { sessionId: "s2", cwd: "/proj", title: "Another", updatedAt: "2026-01-02T00:00:00Z" },
        ],
      },
    })

    const result = await listSessionsFromBridge({
      wsUrl: "ws://test",
      cwd: "/proj",
      warmupDelayMs: 0,
    })

    expect(result.isOk()).toBe(true)
    const sessions = result._unsafeUnwrap()
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.sessionId).toBe("s1")
    expect(sessions[0]?.title).toBe("My session")
    expect(sessions[1]?.sessionId).toBe("s2")
  })

  it("returns empty array when sessions list is empty", async () => {
    reset({ listSessionsResult: { sessions: [] } })

    const result = await listSessionsFromBridge({
      wsUrl: "ws://test",
      cwd: "/proj",
      warmupDelayMs: 0,
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toHaveLength(0)
  })

  it("returns ok([]) as fallback when CLI returns -32601 method not found", async () => {
    reset({
      listSessionsError: { code: -32601, message: "Method not found" },
    })

    const result = await listSessionsFromBridge({
      wsUrl: "ws://test",
      cwd: "/proj",
      warmupDelayMs: 0,
    })

    // Gemini fallback: -32601 → empty array, not an error
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toHaveLength(0)
  })

  it("returns err on WS transport error (connection refused)", async () => {
    reset({ openError: true })

    const result = await listSessionsFromBridge({
      wsUrl: "ws://bad",
      cwd: "/proj",
      warmupDelayMs: 0,
    })

    expect(result.isErr()).toBe(true)
    const err = result._unsafeUnwrapErr()
    expect(err.kind).toBe("transport")
    expect(err.message).toMatch(/ACP WS error/)
  })

  it("sends session/list (not session/new) over the wire", async () => {
    reset({ listSessionsResult: { sessions: [] } })

    await listSessionsFromBridge({ wsUrl: "ws://test", cwd: "/proj", warmupDelayMs: 0 })

    const ws = mockInstances[0]
    const methods = ws?.sentMessages
      .map((m) => {
        try {
          return (JSON.parse(m.trim()) as { method?: string }).method
        } catch {
          return null
        }
      })
      .filter(Boolean)

    expect(methods).toContain("session/list")
    expect(methods).not.toContain("session/new")
  })
})

// ─── createAcpWsLoadTransport ────────────────────────────────────────────────

describe("createAcpWsLoadTransport", () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    reset()
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it("transport.start() returns the loaded sessionId", async () => {
    reset({ loadSessionResult: { sessionId: "existing-sess-42" } })

    const transport = await createAcpWsLoadTransport({
      wsUrl: "ws://test",
      cwd: "/proj",
      sessionId: "existing-sess-42",
      onHistoryUpdate: () => {},
      warmupDelayMs: 0,
    })

    const { sessionId } = await transport.start({ cwd: "/proj" })
    expect(sessionId).toBe("existing-sess-42")
  })

  it("capabilities come from initialize response (loadSession=true)", async () => {
    reset({
      initializeResult: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: "oc", version: "1" },
      },
      loadSessionResult: { sessionId: "s" },
    })

    const transport = await createAcpWsLoadTransport({
      wsUrl: "ws://test",
      cwd: "/proj",
      sessionId: "s",
      onHistoryUpdate: () => {},
      warmupDelayMs: 0,
    })

    const { capabilities } = await transport.start({ cwd: "/proj" })
    expect(capabilities.loadSession).toBe(true)
  })

  it("history notifications are forwarded to onHistoryUpdate in order", async () => {
    const n1 = {
      sessionId: "s",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } },
    }
    const n2 = {
      sessionId: "s",
      update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "World" } },
    }

    reset({
      loadSessionResult: { sessionId: "s" },
      loadSessionNotifications: [n1, n2],
    })

    const received: unknown[] = []
    await createAcpWsLoadTransport({
      wsUrl: "ws://test",
      cwd: "/proj",
      sessionId: "s",
      onHistoryUpdate: (n) => received.push(n),
      warmupDelayMs: 0,
    })

    expect(received).toHaveLength(2)
    const first = received[0] as { update: { sessionUpdate: string } }
    expect(first.update.sessionUpdate).toBe("agent_message_chunk")
    const second = received[1] as { update: { sessionUpdate: string } }
    expect(second.update.sessionUpdate).toBe("user_message_chunk")
  })

  it("sends session/load (not session/new) over the wire", async () => {
    reset({ loadSessionResult: { sessionId: "s" } })

    await createAcpWsLoadTransport({
      wsUrl: "ws://test",
      cwd: "/proj",
      sessionId: "s",
      onHistoryUpdate: () => {},
      warmupDelayMs: 0,
    })

    const ws = mockInstances[0]
    const methods = ws?.sentMessages
      .map((m) => {
        try {
          return (JSON.parse(m.trim()) as { method?: string }).method
        } catch {
          return null
        }
      })
      .filter(Boolean)

    expect(methods).toContain("session/load")
    expect(methods).not.toContain("session/new")
  })

  it("transport.prompt() uses the loaded sessionId", async () => {
    reset({ loadSessionResult: { sessionId: "loaded-42" } })

    const transport = await createAcpWsLoadTransport({
      wsUrl: "ws://test",
      cwd: "/proj",
      sessionId: "loaded-42",
      onHistoryUpdate: () => {},
      warmupDelayMs: 0,
    })

    await transport.start({ cwd: "/proj" })
    await transport.prompt({ text: "hello" }, () => {})

    const ws = mockInstances[0]
    const promptLine = ws?.sentMessages.find((m) => m.includes('"session/prompt"')) ?? ""
    const parsed = JSON.parse(promptLine.trim()) as { params: { sessionId: string } }
    expect(parsed.params.sessionId).toBe("loaded-42")
  })

  it("rejects when session/load returns an error (bad sessionId)", async () => {
    reset({
      loadSessionError: { code: -32602, message: "Session not found" },
    })

    await expect(
      createAcpWsLoadTransport({
        wsUrl: "ws://test",
        cwd: "/proj",
        sessionId: "bad-session-id",
        onHistoryUpdate: () => {},
        warmupDelayMs: 0,
      }),
    ).rejects.toThrow()
  })

  it("onHistoryUpdate is cleared after load completes (future prompts don't replay history)", async () => {
    const historyNote = {
      sessionId: "s",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "History" } },
    }

    reset({
      loadSessionResult: { sessionId: "s" },
      loadSessionNotifications: [historyNote],
      promptNotifications: [
        {
          sessionId: "s",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Live response" },
          },
        },
      ],
    })

    const historyReceived: unknown[] = []
    const promptReceived: unknown[] = []

    const transport = await createAcpWsLoadTransport({
      wsUrl: "ws://test",
      cwd: "/proj",
      sessionId: "s",
      onHistoryUpdate: (n) => historyReceived.push(n),
      warmupDelayMs: 0,
    })

    await transport.start({ cwd: "/proj" })
    await transport.prompt({ text: "hi" }, (n) => promptReceived.push(n))

    // History callback only received history events
    expect(historyReceived).toHaveLength(1)
    // Prompt callback only received prompt notifications
    expect(promptReceived).toHaveLength(1)
  })
})
