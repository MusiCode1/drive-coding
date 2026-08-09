/**
 * session-host.integration.test.ts — Integration tests for SessionHost + ProviderConnection (C4).
 *
 * Testing: integration (brief §C4)
 *
 * Tests the full wiring of createSessionHostFromConnection:
 *   - InProcessAcpTransport is created from conn.wire + conn.onCrash
 *   - AcpClientCallbacks are wired: onUpdate → reduce, onRequestPermission → PendingRequests
 *   - State updates from pumped lines → SessionHost.state
 *   - User message synthesis + meta passthrough
 *   - Permission requests → PendingRequests + respondPermission resolves them
 *   - Permission timeout with default deny
 *
 * Uses injectable _createAcpClient dep to avoid the ACP initialize handshake complexity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { BridgeCrashInfo } from "@drive-coding/provider/spawn"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import type { AcpTransport } from "@drive-coding/provider/transport"
import { createSessionHostFromConnection } from "./session-host.js"

// ── mock helpers ─────────────────────────────────────────────────────────────

function makeMockAcpClient(overrides: Partial<AcpClient> = {}): AcpClient {
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
    ...overrides,
  } as unknown as AcpClient
}

function makeMockConnection(): {
  conn: ProviderConnection
  _triggerLine: (line: string) => void
  _triggerCrash: (info: BridgeCrashInfo) => void
} {
  const lineListeners: Array<(line: string) => void> = []
  const crashListeners: Array<(info: BridgeCrashInfo) => void> = []

  const conn: ProviderConnection = {
    wire: {
      onLine: vi.fn((cb: (line: string) => void) => {
        lineListeners.push(cb)
        return () => {
          const i = lineListeners.indexOf(cb)
          if (i >= 0) lineListeners.splice(i, 1)
        }
      }),
      write: vi.fn(() => true),
    },
    capabilities: {} as ProviderConnection["capabilities"],
    onFrame: vi.fn(() => () => {}),
    turn: {
      isBusy: vi.fn(() => false),
      lastActivityAt: vi.fn(() => null),
      onChange: vi.fn(() => () => {}),
    },
    onCrash: vi.fn((cb: (info: BridgeCrashInfo) => void) => {
      crashListeners.push(cb)
      return () => {
        const i = crashListeners.indexOf(cb)
        if (i >= 0) crashListeners.splice(i, 1)
      }
    }),
    close: vi.fn().mockResolvedValue(undefined),
    pid: null,
  } as unknown as ProviderConnection

  return {
    conn,
    _triggerLine: (line: string) => lineListeners.forEach((cb) => cb(line)),
    _triggerCrash: (info: BridgeCrashInfo) => crashListeners.forEach((cb) => cb(info)),
  }
}

/** Build a SessionNotification for test pumping */
function makeSessionNotification(update: Record<string, unknown>): SessionNotification {
  return {
    sessionId: "s1",
    update: update as SessionNotification["update"],
  }
}

// ── test setup ────────────────────────────────────────────────────────────────

async function setup(permissionTimeoutMs = 5000, elicitationTimeoutMs = 5000) {
  const { conn, _triggerLine, _triggerCrash } = makeMockConnection()
  let capturedCallbacks: AcpClientCallbacks | undefined
  let capturedTransport: AcpTransport | undefined
  const mockClient = makeMockAcpClient()

  const host = await createSessionHostFromConnection(conn, {
    permissionTimeoutMs,
    elicitationTimeoutMs,
    _createAcpClient: async (transport: AcpTransport, callbacks: AcpClientCallbacks) => {
      capturedTransport = transport
      capturedCallbacks = callbacks
      return mockClient
    },
  })

  return {
    host,
    conn,
    mockClient,
    get callbacks() {
      if (!capturedCallbacks) throw new Error("_createAcpClient was never called")
      return capturedCallbacks
    },
    get transport() {
      if (!capturedTransport) throw new Error("_createAcpClient was never called")
      return capturedTransport
    },
    _triggerLine,
    _triggerCrash,
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("createSessionHostFromConnection", () => {
  describe("wiring", () => {
    it("creates a transport that subscribes to conn.wire.onLine", async () => {
      const { conn } = await setup()
      expect((conn.wire.onLine as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    })

    it("creates a transport that subscribes to conn.onCrash", async () => {
      const { conn } = await setup()
      expect((conn.onCrash as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    })

    it("calls _createAcpClient with the transport and callbacks", async () => {
      const { transport, callbacks } = await setup()
      expect(transport).toBeDefined()
      expect(callbacks).toBeDefined()
      expect(typeof callbacks.onUpdate).toBe("function")
      expect(typeof callbacks.onRequestPermission).toBe("function")
      expect(typeof callbacks.onCreateElicitation).toBe("function")
    })
  })

  describe("state updates via onUpdate", () => {
    it("session_info_update → title changes in host.state", async () => {
      const { host, callbacks } = await setup()

      callbacks.onUpdate(makeSessionNotification({
        sessionUpdate: "session_info_update",
        title: "From Connection",
      }))

      expect(host.state.title).toBe("From Connection")
    })

    it("multiple updates increment version", async () => {
      const { host, callbacks } = await setup()

      const v0 = host.state.version
      callbacks.onUpdate(makeSessionNotification({ sessionUpdate: "session_info_update", title: "A" }))
      callbacks.onUpdate(makeSessionNotification({ sessionUpdate: "session_info_update", title: "B" }))

      expect(host.state.version).toBe(v0 + 2)
    })

    it("patches stream emits patches for each update", async () => {
      const { host, callbacks } = await setup()

      const reader = host.patches.getReader()

      callbacks.onUpdate(makeSessionNotification({
        sessionUpdate: "session_info_update",
        title: "Patch Test",
      }))

      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 200)),
      ])
      reader.releaseLock()

      expect(result.done).toBe(false)
      const patch = result.value
      expect(patch?.op).toBe("update-session")
    })
  })

  describe("user message synthesis + meta passthrough", () => {
    it("prompt() adds user message to state with meta", async () => {
      const { host } = await setup()
      const meta = { agentId: "a1" }

      await host.prompt("s1", "hello from conn", meta)

      const msg = host.state.messages[0]
      expect(msg?.role).toBe("user")
      expect(msg?.meta).toEqual(meta)
    })

    it("prompt() calls mockClient.prompt", async () => {
      const { host, mockClient } = await setup()

      await host.prompt("s1", "test content")

      expect(mockClient.prompt).toHaveBeenCalledWith("s1", "test content")
    })
  })

  describe("permission requests → PendingRequests", () => {
    it("onRequestPermission creates a pending request resolved by respondPermission", async () => {
      const { host, callbacks } = await setup()

      // Simulate incoming permission request (called by ACP SDK internally)
      const responsePromise = callbacks.onRequestPermission!({
        sessionId: "s1",
        toolCall: {
          toolCallId: "tc1",
          name: "run_bash",
          status: "pending",
        } as Parameters<typeof callbacks.onRequestPermission>[0]["toolCall"],
        options: [],
      } as Parameters<typeof callbacks.onRequestPermission>[0])

      // The host should have a pending permission (requestId = 0)
      // Respond to it
      const responded = host.respondPermission(0, {
        outcome: { outcome: "cancelled" },
      })

      const response = await responsePromise
      expect(response.outcome.outcome).toBe("cancelled")
    })

    it("onRequestPermission times out with default deny when not responded", async () => {
      vi.useFakeTimers()
      const { host, callbacks } = await setup(100)

      const responsePromise = callbacks.onRequestPermission!({
        sessionId: "s1",
        toolCall: {
          toolCallId: "tc2",
          name: "run_bash",
          status: "pending",
        } as Parameters<typeof callbacks.onRequestPermission>[0]["toolCall"],
        options: [],
      } as Parameters<typeof callbacks.onRequestPermission>[0])

      vi.advanceTimersByTime(101)
      vi.useRealTimers()

      const response = await responsePromise
      // Default deny outcome
      expect(response.outcome.outcome).toBe("cancelled")
    })
  })

  describe("elicitation requests → PendingRequests", () => {
    it("onCreateElicitation defaults to cancel when not responded", async () => {
      vi.useFakeTimers()
      const { callbacks } = await setup(100, 100)  // elicitationTimeoutMs=100

      const responsePromise = callbacks.onCreateElicitation!({
        sessionId: "s1",
        requestId: 1,
        schema: { type: "object", properties: {} },
      } as Parameters<typeof callbacks.onCreateElicitation>[0])

      // Default value resolves immediately on timeout
      vi.advanceTimersByTime(101)
      vi.useRealTimers()

      const response = await responsePromise
      expect(response.action).toBe("cancel")
    })
  })

  describe("S4 extensions — setMode / setConfigOption / extMethod", () => {
    it("setMode delegates to client.setSessionMode with currentState.sessionId", async () => {
      const { host, mockClient } = await setup()

      // Establish a sessionId via newSession (returns { sessionId: 's1' } from mockClient)
      await host.newSession({ cwd: "/test" })

      await host.setMode("compact")

      expect(mockClient.setSessionMode).toHaveBeenCalledWith({
        sessionId: "s1",
        modeId: "compact",
      })
    })

    it("setMode throws 'No session' when sessionId is null", async () => {
      const { host } = await setup()
      // No session started — sessionId is null
      await expect(host.setMode("compact")).rejects.toThrow("No session")
    })

    it("setConfigOption delegates to client.setSessionConfigOption with string value", async () => {
      const { host, mockClient } = await setup()

      await host.newSession({ cwd: "/test" })

      await host.setConfigOption("model", "claude-3-5-sonnet")

      expect(mockClient.setSessionConfigOption).toHaveBeenCalledWith({
        sessionId: "s1",
        configId: "model",
        value: "claude-3-5-sonnet",
      })
    })

    it("setConfigOption delegates to client.setSessionConfigOption with boolean value", async () => {
      const { host, mockClient } = await setup()

      await host.newSession({ cwd: "/test" })

      await host.setConfigOption("verbose", true)

      expect(mockClient.setSessionConfigOption).toHaveBeenCalledWith({
        sessionId: "s1",
        configId: "verbose",
        value: true,
      })
    })

    it("setConfigOption throws 'No session' when sessionId is null", async () => {
      const { host } = await setup()
      await expect(host.setConfigOption("model", "x")).rejects.toThrow("No session")
    })

    it("extMethod delegates to client.extMethod with method + params", async () => {
      const { host, mockClient } = await setup()

      await host.extMethod("_drive/custom", { foo: "bar", n: 42 })

      expect(mockClient.extMethod).toHaveBeenCalledWith("_drive/custom", { foo: "bar", n: 42 })
    })

    it("extMethod works without an active sessionId (no null-guard needed)", async () => {
      const { host, mockClient } = await setup()
      // extMethod does NOT require a sessionId (no guard)
      await expect(host.extMethod("_drive/ping", {})).resolves.not.toThrow()
      expect(mockClient.extMethod).toHaveBeenCalled()
    })
  })
})
