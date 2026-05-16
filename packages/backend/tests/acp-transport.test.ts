import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * MockWebSocket — simulates a stdio-to-ws bridge for acp-transport tests.
 *
 * - Constructor accepts wsUrl (recorded for assertions).
 * - On next microtask, fires "open" (unless options.openError → fires "error" instead).
 * - On next tick after open, emits `{"type":"connected","clientId":"..."}` frame
 *   (unless options.skipConnected = true).
 * - Captures every `.send(line)`. If the line is an ACP JSON-RPC request,
 *   replies via `emit('message', ...)` per handler config.
 *
 * Default handlers:
 *   initialize  → { agentCapabilities: { loadSession: true }, ... }
 *   session/new → { sessionId: "sess-mock-1" }
 *   session/prompt → { stopReason: "end_turn" } after `promptNotifications`
 *   session/cancel → null
 *
 * Override via MOCK_OPTIONS.
 */
type MockWebSocketOptions = {
  skipConnected?: boolean
  openError?: boolean
  initializeResult?: unknown
  initializeError?: { code: number; message: string; data?: unknown }
  newSessionResult?: unknown
  promptResult?: unknown
  promptNotifications?: unknown[]
}

let MOCK_OPTIONS: MockWebSocketOptions = {}
const mockInstances: MockWebSocket[] = []

class MockWebSocket extends EventEmitter {
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
      if (MOCK_OPTIONS.openError) {
        this.emit("error", new Error("connection refused"))
        return
      }
      this.readyState = this.OPEN
      this.emit("open")
      if (!MOCK_OPTIONS.skipConnected) {
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
      if (MOCK_OPTIONS.initializeError) {
        this.respondError(parsed.id ?? 0, MOCK_OPTIONS.initializeError)
        return
      }
      const result = MOCK_OPTIONS.initializeResult ?? {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: "mock-agent", version: "0.0.1" },
      }
      this.respond(parsed.id ?? 0, result)
    } else if (parsed.method === "session/new") {
      const result = MOCK_OPTIONS.newSessionResult ?? { sessionId: "sess-mock-1" }
      this.respond(parsed.id ?? 0, result)
    } else if (parsed.method === "session/prompt") {
      for (const note of MOCK_OPTIONS.promptNotifications ?? []) {
        const frame = `${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: note })}\n`
        queueMicrotask(() => this.emit("message", Buffer.from(frame, "utf8")))
      }
      const result = MOCK_OPTIONS.promptResult ?? { stopReason: "end_turn" }
      this.respond(parsed.id ?? 0, result)
    } else if (parsed.method === "session/cancel") {
      this.respond(parsed.id ?? 0, null)
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
  WebSocket: MockWebSocket,
  default: MockWebSocket,
}))

// Import AFTER mock
const { createAcpWsTransport } = await import("../src/acp/acp-transport.js")

function resetMockState(opts: MockWebSocketOptions = {}) {
  MOCK_OPTIONS = opts
  mockInstances.length = 0
}

describe("createAcpWsTransport", () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    resetMockState()
  })

  afterEach(() => {
    logSpy.mockRestore()
    vi.useRealTimers()
  })

  it("happy path: open → connected → initialize → newSession → returns transport", async () => {
    const transport = await createAcpWsTransport({ wsUrl: "ws://test", cwd: "/tmp" })
    const { sessionId, capabilities } = await transport.start({ cwd: "/tmp" })

    expect(sessionId).toBe("sess-mock-1")
    expect(capabilities.loadSession).toBe(true)
  })

  it("capabilities default to loadSession=false when agentCapabilities absent", async () => {
    resetMockState({
      initializeResult: {
        protocolVersion: 1,
        agentInfo: { name: "x", version: "1" },
      },
    })
    const transport = await createAcpWsTransport({ wsUrl: "ws://test", cwd: "/tmp" })
    const { capabilities } = await transport.start({ cwd: "/tmp" })
    expect(capabilities.loadSession).toBe(false)
  })

  it("sessionId from newSession result is preserved", async () => {
    resetMockState({ newSessionResult: { sessionId: "sess-XYZ-123" } })
    const transport = await createAcpWsTransport({ wsUrl: "ws://test", cwd: "/tmp" })
    const { sessionId } = await transport.start({ cwd: "/tmp" })
    expect(sessionId).toBe("sess-XYZ-123")
  })

  it("WS error before open → reject with 'ACP WS error'", async () => {
    resetMockState({ openError: true })
    await expect(createAcpWsTransport({ wsUrl: "ws://bad", cwd: "/tmp" })).rejects.toThrow(
      /ACP WS error/,
    )
  })

  it("stdio-to-ws never sends 'connected' frame → reject after 10s handshake timeout", async () => {
    resetMockState({ skipConnected: true })
    vi.useFakeTimers()
    const p = createAcpWsTransport({ wsUrl: "ws://test", cwd: "/tmp" })
    const expectation = expect(p).rejects.toThrow(/stdio-to-ws handshake/)
    await vi.advanceTimersByTimeAsync(11_000)
    await expectation
  }, 15_000)

  it("initialize sends clientCapabilities.fs.readTextFile + writeTextFile = true", async () => {
    const transport = await createAcpWsTransport({ wsUrl: "ws://test", cwd: "/tmp" })
    await transport.start({ cwd: "/tmp" })

    const ws = mockInstances[0]
    const initLine = ws?.sentMessages.find((m) => m.includes('"initialize"')) ?? ""
    const parsed = JSON.parse(initLine.trim())
    expect(parsed.params.clientCapabilities.fs.readTextFile).toBe(true)
    expect(parsed.params.clientCapabilities.fs.writeTextFile).toBe(true)
  })

  it("initialize sends clientInfo with name='drive-coding' + version", async () => {
    const transport = await createAcpWsTransport({ wsUrl: "ws://test", cwd: "/tmp" })
    await transport.start({ cwd: "/tmp" })

    const ws = mockInstances[0]
    const initLine = ws?.sentMessages.find((m) => m.includes('"initialize"')) ?? ""
    const parsed = JSON.parse(initLine.trim())
    expect(parsed.params.clientInfo.name).toBe("drive-coding")
    expect(typeof parsed.params.clientInfo.version).toBe("string")
  })

  it("session/new uses the given cwd", async () => {
    const transport = await createAcpWsTransport({ wsUrl: "ws://test", cwd: "/my/project" })
    await transport.start({ cwd: "/my/project" })

    const ws = mockInstances[0]
    const newSessLine = ws?.sentMessages.find((m) => m.includes('"session/new"')) ?? ""
    const parsed = JSON.parse(newSessLine.trim())
    expect(parsed.params.cwd).toBe("/my/project")
  })

  it("custom protocolVersion is forwarded", async () => {
    const transport = await createAcpWsTransport({
      wsUrl: "ws://test",
      cwd: "/tmp",
      protocolVersion: 42,
    })
    await transport.start({ cwd: "/tmp" })

    const ws = mockInstances[0]
    const initLine = ws?.sentMessages.find((m) => m.includes('"initialize"')) ?? ""
    const parsed = JSON.parse(initLine.trim())
    expect(parsed.params.protocolVersion).toBe(42)
  })

  it("prompt() forwards text + returns response", async () => {
    const transport = await createAcpWsTransport({ wsUrl: "ws://test", cwd: "/tmp" })
    await transport.start({ cwd: "/tmp" })

    const res = await transport.prompt({ text: "hello" }, () => {})
    expect(res.stopReason).toBe("end_turn")

    const ws = mockInstances[0]
    const promptLine = ws?.sentMessages.find((m) => m.includes('"session/prompt"')) ?? ""
    const parsed = JSON.parse(promptLine.trim())
    expect(parsed.params.prompt).toEqual([{ type: "text", text: "hello" }])
  })

  it("prompt onUpdate callback receives notifications", async () => {
    const notification = {
      sessionId: "sess-mock-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi from agent" },
      },
    }
    resetMockState({ promptNotifications: [notification] })

    const transport = await createAcpWsTransport({ wsUrl: "ws://test", cwd: "/tmp" })
    await transport.start({ cwd: "/tmp" })

    const updates: unknown[] = []
    await transport.prompt({ text: "say hi" }, (n) => updates.push(n))

    expect(updates).toHaveLength(1)
  })

  it("cancel() sends session/cancel JSON-RPC with sessionId", async () => {
    const transport = await createAcpWsTransport({ wsUrl: "ws://test", cwd: "/tmp" })
    await transport.start({ cwd: "/tmp" })

    await transport.cancel()

    const ws = mockInstances[0]
    const cancelLine = ws?.sentMessages.find((m) => m.includes('"session/cancel"')) ?? ""
    expect(cancelLine).toBeTruthy()
    const parsed = JSON.parse(cancelLine.trim())
    expect(parsed.params.sessionId).toBe("sess-mock-1")
  })

  it("shutdown() closes the WebSocket", async () => {
    const transport = await createAcpWsTransport({ wsUrl: "ws://test", cwd: "/tmp" })
    await transport.start({ cwd: "/tmp" })

    await transport.shutdown()

    const ws = mockInstances[0]
    expect(ws?.close).toHaveBeenCalled()
  })

  it("auth_required error during initialize → rejects with kind='auth_required'", async () => {
    resetMockState({
      initializeError: {
        code: -32000,
        message: "auth required",
        data: { code: "auth_required" },
      },
    })

    const p = createAcpWsTransport({ wsUrl: "ws://test", cwd: "/tmp" })
    await expect(p).rejects.toThrow(/auth/i)
    try {
      await p
      throw new Error("expected rejection")
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe("auth_required")
    }
  })
})
