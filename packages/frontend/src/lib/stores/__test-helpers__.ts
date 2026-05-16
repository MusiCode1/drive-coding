import { vi } from "vitest"
import type { AgentSessionPublic } from "./agent-session.svelte"

// ─── MockWebSocket ────────────────────────────────────────────────────────────

export class MockWebSocket {
  static instances: MockWebSocket[] = []
  readyState = 1 // OPEN
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
    queueMicrotask(() => this.onopen?.())
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.onclose?.()
  }
}

// Add static constants so stores can use WebSocket.OPEN etc.
Object.defineProperty(MockWebSocket, "OPEN", { value: 1, writable: false })
Object.defineProperty(MockWebSocket, "CLOSED", { value: 3, writable: false })
Object.defineProperty(MockWebSocket, "CONNECTING", { value: 0, writable: false })

export function installWebSocketMock() {
  MockWebSocket.instances = []
  vi.stubGlobal("WebSocket", MockWebSocket)
}

/** Returns the most recently created MockWebSocket (throws if none created yet). */
export function getLastWs(): MockWebSocket {
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
  if (!ws) throw new Error("No MockWebSocket instances found — did you call installWebSocketMock?")
  return ws
}

// ─── makeMockSession ──────────────────────────────────────────────────────────

export function makeMockSession(overrides: Partial<AgentSessionPublic> = {}): AgentSessionPublic {
  return {
    agentId: "test-agent",
    messages: [],
    status: "connected",
    error: null,
    isConnected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendPrompt: vi.fn(),
    sendRaw: vi.fn(() => true),
    cancel: vi.fn(),
    setVoiceMessageHandler: vi.fn(),
    ...overrides,
  }
}

// ─── MockMediaRecorder ────────────────────────────────────────────────────────

export class MockMediaRecorder {
  static last: MockMediaRecorder | null = null
  state = "inactive"
  mimeType = "audio/webm"
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  stream = { getTracks: () => [{ stop: vi.fn() }] }

  constructor(_stream: unknown) {
    MockMediaRecorder.last = this
  }

  start() {
    this.state = "recording"
  }

  stop() {
    this.state = "inactive"
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["fake-audio"], { type: "audio/webm" }) })
      queueMicrotask(() => {
        this.onstop?.()
      })
    })
  }
}

export function installMediaMocks() {
  MockMediaRecorder.last = null
  vi.stubGlobal("MediaRecorder", MockMediaRecorder)
  // Also mock isTypeSupported
  const MockMR = MockMediaRecorder as unknown as { isTypeSupported: (mime: string) => boolean }
  MockMR.isTypeSupported = (_mime: string) => false

  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
      }),
    },
  })
}

// ─── flushAsync ──────────────────────────────────────────────────────────────

/** Flush microtasks + a small macrotask delay to let async chains settle. */
export const flushAsync = () => new Promise<void>((r) => setTimeout(r, 50))
