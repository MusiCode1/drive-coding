/**
 * registry.test.ts — TDD tests for AgentSessionRegistry (C1).
 *
 * Testing: tdd (brief §C1)
 *
 * Tests:
 *   - getHost: returns existing host or undefined
 *   - getOrCreateHost: async lazy creation, returns {host, broadcaster}
 *   - getOrCreateHost: returns undefined if connection not found
 *   - getBroadcaster: returns existing broadcaster or undefined
 *   - unregisterHost: removes host + broadcaster from map
 *   - lifecycle: creates broadcaster alongside host (one per host)
 */

import type { ProviderConnection } from "@drive-coding/provider/connection"
import { describe, expect, it, vi } from "vitest"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import type { PatchesBroadcaster } from "./patches-broadcaster.js"
import { createAgentSessionRegistry } from "./registry.js"
import type { ExtendedSessionHost } from "./session-host.js"

// ── mock helpers ──────────────────────────────────────────────────────────────

function makeMockConnection(): ProviderConnection {
  return {
    wire: {
      onLine: vi.fn(() => () => {}),
      write: vi.fn(() => true),
    },
    capabilities: {} as ProviderConnection["capabilities"],
    onFrame: vi.fn(() => () => {}),
    turn: {
      isBusy: vi.fn(() => false),
      lastActivityAt: vi.fn(() => null),
      onChange: vi.fn(() => () => {}),
    },
    onCrash: vi.fn(() => () => {}),
    close: vi.fn().mockResolvedValue(undefined),
    pid: null,
  } as unknown as ProviderConnection
}

function makeMockConnectionRegistry(conn?: ProviderConnection): ConnectionRegistry {
  return {
    connect: vi.fn(),
    get: vi.fn().mockReturnValue(conn),
    getCwd: vi.fn().mockReturnValue("/tmp/mock-cwd"),
    list: vi.fn().mockReturnValue([]),
    markAttached: vi.fn(),
    markDetached: vi.fn(),
    getRuntimeInfo: vi.fn().mockReturnValue(null),
    close: vi.fn().mockResolvedValue(undefined),
    onCrash: vi.fn(() => () => {}),
  } as unknown as ConnectionRegistry
}

function makeMockHost(sessionId: string | null = null): ExtendedSessionHost {
  const patches = new ReadableStream<import("@drive-coding/core/session").Patch>({
    start() {},
  })
  return {
    state: { version: 0, sessionId } as ExtendedSessionHost["state"],
    patches,
    prompt: vi.fn().mockResolvedValue(undefined),
    newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    cancel: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
    setConfigOption: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({}),
    respondPermission: vi.fn(),
    respondElicitation: vi.fn(),
  }
}

function makeMockBroadcaster(): PatchesBroadcaster {
  return {
    subscribe: vi.fn().mockReturnValue(new ReadableStream()),
    unsubscribe: vi.fn(),
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("AgentSessionRegistry", () => {
  describe("getHost", () => {
    it("returns undefined for an unknown agentId", () => {
      const registry = createAgentSessionRegistry({
        connectionRegistry: makeMockConnectionRegistry(),
        _createHostFn: vi.fn(),
        _createBroadcasterFn: vi.fn(),
      })
      expect(registry.getHost("unknown")).toBeUndefined()
    })

    it("returns the host after getOrCreateHost is called", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost()
      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await registry.getOrCreateHost("agent-1")
      expect(registry.getHost("agent-1")).toBe(mockHost)
    })
  })

  describe("getOrCreateHost", () => {
    it("returns undefined if connection not found in connectionRegistry", async () => {
      const connectionRegistry = makeMockConnectionRegistry(undefined)
      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn(),
        _createBroadcasterFn: vi.fn(),
      })

      const result = await registry.getOrCreateHost("missing-agent")
      expect(result).toBeUndefined()
    })

    it("creates and returns {host, broadcaster} when connection exists", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost()
      const mockBroadcaster = makeMockBroadcaster()
      const createHostFn = vi.fn().mockResolvedValue(mockHost)
      const createBroadcasterFn = vi.fn().mockReturnValue(mockBroadcaster)

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: createHostFn,
        _createBroadcasterFn: createBroadcasterFn,
      })

      const result = await registry.getOrCreateHost("agent-1")

      expect(result).toBeDefined()
      expect(result?.host).toBe(mockHost)
      expect(result?.broadcaster).toBe(mockBroadcaster)
    })

    it("creates host with the connection from connectionRegistry", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost()
      const createHostFn = vi.fn().mockResolvedValue(mockHost)

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: createHostFn,
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await registry.getOrCreateHost("agent-1")

      expect(createHostFn).toHaveBeenCalledWith(conn)
    })

    it("creates broadcaster with host.patches", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost()
      const createBroadcasterFn = vi.fn().mockReturnValue(makeMockBroadcaster())

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: createBroadcasterFn,
      })

      await registry.getOrCreateHost("agent-1")

      expect(createBroadcasterFn).toHaveBeenCalledWith(mockHost.patches)
    })

    it("returns existing {host, broadcaster} on second call (no re-creation)", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const createHostFn = vi.fn().mockResolvedValue(makeMockHost())
      const createBroadcasterFn = vi.fn().mockReturnValue(makeMockBroadcaster())

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: createHostFn,
        _createBroadcasterFn: createBroadcasterFn,
      })

      const first = await registry.getOrCreateHost("agent-1")
      const second = await registry.getOrCreateHost("agent-1")

      expect(createHostFn).toHaveBeenCalledTimes(1)
      expect(first).toBe(second)
    })

    it("uses agentId as key (different agents get different hosts)", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const createHostFn = vi
        .fn()
        .mockResolvedValueOnce(makeMockHost())
        .mockResolvedValueOnce(makeMockHost())

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: createHostFn,
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      const r1 = await registry.getOrCreateHost("agent-1")
      const r2 = await registry.getOrCreateHost("agent-2")

      expect(r1?.host).not.toBe(r2?.host)
      expect(createHostFn).toHaveBeenCalledTimes(2)
    })

    // ─── slice remote-session-view, הכרעה 1: auto session creation ───

    it("auto-creates a session via host.newSession({cwd}) when host has no sessionId", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost(null)

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await registry.getOrCreateHost("agent-1")

      expect(mockHost.newSession).toHaveBeenCalledWith({ cwd: "/tmp/mock-cwd" })
      expect(connectionRegistry.getCwd).toHaveBeenCalledWith("agent-1")
    })

    it("does not call host.newSession again if host already has a sessionId", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost("already-connected-session")

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await registry.getOrCreateHost("agent-1")

      expect(mockHost.newSession).not.toHaveBeenCalled()
    })

    it("throws if no cwd is registered for agentId (cannot auto-create session)", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      ;(connectionRegistry.getCwd as ReturnType<typeof vi.fn>).mockReturnValue(undefined)
      const mockHost = makeMockHost(null)

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await expect(registry.getOrCreateHost("agent-1")).rejects.toThrow("no cwd registered")
    })

    it("does not auto-create a session again on the second (cached) getOrCreateHost call", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost(null)

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await registry.getOrCreateHost("agent-1")
      await registry.getOrCreateHost("agent-1")

      expect(mockHost.newSession).toHaveBeenCalledTimes(1)
    })
  })

  describe("getBroadcaster", () => {
    it("returns undefined for an unknown agentId", () => {
      const registry = createAgentSessionRegistry({
        connectionRegistry: makeMockConnectionRegistry(),
        _createHostFn: vi.fn(),
        _createBroadcasterFn: vi.fn(),
      })
      expect(registry.getBroadcaster("unknown")).toBeUndefined()
    })

    it("returns the broadcaster after getOrCreateHost is called", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockBroadcaster = makeMockBroadcaster()

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(makeMockHost()),
        _createBroadcasterFn: vi.fn().mockReturnValue(mockBroadcaster),
      })

      await registry.getOrCreateHost("agent-1")
      expect(registry.getBroadcaster("agent-1")).toBe(mockBroadcaster)
    })
  })

  describe("unregisterHost", () => {
    it("removes the host from the registry", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(makeMockHost()),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await registry.getOrCreateHost("agent-1")
      registry.unregisterHost("agent-1")

      expect(registry.getHost("agent-1")).toBeUndefined()
      expect(registry.getBroadcaster("agent-1")).toBeUndefined()
    })

    it("is a no-op for an unknown agentId (no throw)", () => {
      const registry = createAgentSessionRegistry({
        connectionRegistry: makeMockConnectionRegistry(),
        _createHostFn: vi.fn(),
        _createBroadcasterFn: vi.fn(),
      })
      expect(() => registry.unregisterHost("unknown")).not.toThrow()
    })
  })
})
