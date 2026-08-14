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

/**
 * makeTouchState — מצב-חיות אמיתי ל-mock: `touch()` כותב את הזמן הנוכחי,
 * `get()` מחזיר את מה שנכתב. בלי זה טסט "touchOwner מונע פקיעה" עובר תמיד.
 */
function makeTouchState(initial: number | null = null) {
  let last: number | null = initial
  return {
    touch: vi.fn(() => {
      last = Date.now()
    }),
    get: vi.fn(() => last),
    _set: (v: number | null) => {
      last = v
    },
  }
}

function makeMockConnectionRegistry(
  conn?: ProviderConnection,
  attached = false,
  touchState = makeTouchState(),
): ConnectionRegistry {
  return {
    connect: vi.fn(),
    get: vi.fn().mockReturnValue(conn),
    getCwd: vi.fn().mockReturnValue("/tmp/mock-cwd"),
    list: vi.fn().mockReturnValue([]),
    markAttached: vi.fn(),
    markDetached: vi.fn(),
    markOwned: vi.fn(),
    // slice ownership-handoff C4b: ה-mock מחזיק **מצב אמיתי** —
    // ⚠️ mock ש-getLastSeenAt שלו מחזיר Date.now() בכל קריאה הופך כל טסט-חיות
    // ל-false-positive: now-lastSeen=0 תמיד, גם אם touchOwner הוא no-op.
    // (כלב NO-GO). כאן touchOwner **כותב** ו-getLastSeenAt **קורא**.
    touchOwner: touchState.touch,
    getLastSeenAt: touchState.get,
    isAttached: vi.fn().mockReturnValue(attached),
    getOwner: vi.fn().mockReturnValue(null),
    getEpoch: vi.fn().mockReturnValue(0),
    isOwnedByWs: vi.fn().mockReturnValue(attached),
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
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({}),
    respondPermission: vi.fn(),
    respondElicitation: vi.fn(),
    listSessions: vi.fn().mockResolvedValue({}),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    agentCapabilities: {},
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

      // slice ownership-handoff C4: _createHostFn מקבל עכשיו גם opts
      // (acpSessionId למסלול warm). הבדיקה על ה-conn בלבד.
      expect(createHostFn).toHaveBeenCalledWith(conn, undefined)
    })

    // ─── slice ownership-handoff C4 (post-calev): מסלול warm ─────────────────
    // כלב NO-GO #2: הקוד היה נכון אך לא נבדק. שלושת הטסטים האלה מוכיחים
    // ש-getAcpSessionId זורם ל-_createHostFn כ-warmReattach, ושהמסלול הקר
    // נשמר כשאין sessionId.

    it("warm path: getAcpSessionId → _createHostFn receives warmReattach opts", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost()
      const createHostFn = vi.fn().mockResolvedValue(mockHost)

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        getAcpSessionId: () => "sess-warm-1",
        _createHostFn: createHostFn,
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await registry.getOrCreateHost("agent-1")

      expect(createHostFn).toHaveBeenCalledWith(
        conn,
        expect.objectContaining({
          warmReattach: expect.objectContaining({ acpSessionId: "sess-warm-1" }),
        }),
      )
    })

    it("warm path: calls loadSession (NOT newSession) when acpSessionId exists", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost()

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        getAcpSessionId: () => "sess-warm-2",
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await registry.getOrCreateHost("agent-1")

      expect(mockHost.loadSession).toHaveBeenCalled()
      expect(mockHost.newSession).not.toHaveBeenCalled()
    })

    it("cold path preserved: no acpSessionId → newSession, no warmReattach opts", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost()
      const createHostFn = vi.fn().mockResolvedValue(mockHost)

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        getAcpSessionId: () => undefined,
        _createHostFn: createHostFn,
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await registry.getOrCreateHost("agent-1")

      expect(createHostFn).toHaveBeenCalledWith(conn, undefined)
      expect(mockHost.newSession).toHaveBeenCalled()
      expect(mockHost.loadSession).not.toHaveBeenCalled()
    })

    // ─── slice ownership-handoff C4b (post-calev): מנגנון החיות ─────────────
    // כלב NO-GO #3: _httpOwnerTtlMs/_httpSweepMs נחשפו לטסטים ואיש לא השתמש בהם.
    // 🔴 הדרישה הקשיחה: פקיעה משחררת בעלות — ולעולם לא נוגעת בסוכן.

    it("http liveness: stale owner is released (dispose + markDetached), agent NOT killed", async () => {
      vi.useFakeTimers()
      try {
        const conn = makeMockConnection()
        // נראה לאחרונה הרבה לפני ה-TTL ⇒ פקוע
        const touchState = makeTouchState(Date.now() - 10_000)
        const connectionRegistry = makeMockConnectionRegistry(conn, false, touchState)
        const mockHost = makeMockHost()

        const registry = createAgentSessionRegistry({
          connectionRegistry,
          _createHostFn: vi.fn().mockResolvedValue(mockHost),
          _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
          _httpOwnerTtlMs: 100,
          _httpSweepMs: 20,
        })

        await registry.getOrCreateHost("agent-1")
        expect(registry.isHeld("agent-1")).toBe(true)

        await vi.advanceTimersByTimeAsync(300)

        // הבעלות שוחררה, והצינור פונה
        expect(mockHost.dispose).toHaveBeenCalled()
        // 🔴 הגבול הקשיח — הסוכן חי
        expect(conn.close).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    // ⚠️ הטסט הזה חייב להיכשל אם touchOwner הוא no-op — לכן ה-mock מחזיק מצב
    // אמיתי, ומתחיל **פקוע**. רק ה-touch מציל אותו. (כלב NO-GO)
    it("http liveness: touchOwner keeps the owner alive past the TTL", async () => {
      vi.useFakeTimers()
      try {
        const conn = makeMockConnection()
        const touchState = makeTouchState(Date.now() - 10_000) // מתחיל פקוע
        const connectionRegistry = makeMockConnectionRegistry(conn, false, touchState)
        const mockHost = makeMockHost()

        const registry = createAgentSessionRegistry({
          connectionRegistry,
          _createHostFn: vi.fn().mockResolvedValue(mockHost),
          _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
          _httpOwnerTtlMs: 100,
          _httpSweepMs: 20,
        })

        await registry.getOrCreateHost("agent-1")
        registry.touchOwner("agent-1") // touch ראשון מיד — מרענן את המצב הפקוע

        // נוגעים כל 40ms — מתחת ל-TTL של 100ms
        for (let i = 0; i < 6; i++) {
          await vi.advanceTimersByTimeAsync(40)
          registry.touchOwner("agent-1")
        }

        expect(mockHost.dispose).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
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

    // ─── calev-heavy M5: concurrent getOrCreateHost(agentId) must not race ───

    it("M5: two concurrent calls for the same agentId create exactly one host + one session", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost(null)
      // simulate real async work — a tick between "start creating" and "resolved",
      // wide enough for a second concurrent caller to race in without the fix
      const createHostFn = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(mockHost), 0)))

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: createHostFn,
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      const [r1, r2] = await Promise.all([
        registry.getOrCreateHost("agent-1"),
        registry.getOrCreateHost("agent-1"),
      ])

      expect(createHostFn).toHaveBeenCalledTimes(1)
      expect(mockHost.newSession).toHaveBeenCalledTimes(1)
      expect(r1).toBe(r2)
      expect(r1?.host).toBe(mockHost)
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

    // ─── calev-heavy round 2 finding #5: no orphaned host on the missing-cwd path ───

    it("does not create a host/broadcaster at all when cwd is missing (fail-fast, no orphan)", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      ;(connectionRegistry.getCwd as ReturnType<typeof vi.fn>).mockReturnValue(undefined)
      const createHostFn = vi.fn().mockResolvedValue(makeMockHost(null))
      const createBroadcasterFn = vi.fn().mockReturnValue(makeMockBroadcaster())

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: createHostFn,
        _createBroadcasterFn: createBroadcasterFn,
      })

      await expect(registry.getOrCreateHost("agent-1")).rejects.toThrow("no cwd registered")

      expect(createHostFn).not.toHaveBeenCalled()
      expect(createBroadcasterFn).not.toHaveBeenCalled()
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

  // ─── slice remote-warm-reconnect C1: onSessionAttached ─────────────────────

  describe("onSessionAttached (slice remote-warm-reconnect C1)", () => {
    /**
     * host שנולד בלי session וש-newSession שלו מעדכן state.sessionId — כמו
     * production (session-host.ts:467). makeMockHost הרגיל לא עושה את זה
     * (ה-newSession שם מחזיר sessionId בלי לגעת ב-state), אז לנתיב יצירת
     * ה-session צריך mock ייעודי.
     */
    function makeAutoSessionHost(): ExtendedSessionHost {
      const host = makeMockHost(null)
      ;(host.newSession as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        host.state.sessionId = "sess-auto-created"
        return { sessionId: "sess-auto-created" }
      })
      return host
    }

    it("calls onSessionAttached with (agentId, real host sessionId) on first creation", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const onSessionAttached = vi.fn()

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(makeAutoSessionHost()),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
        onSessionAttached,
      })

      await registry.getOrCreateHost("agent-1")

      expect(onSessionAttached).toHaveBeenCalledTimes(1)
      expect(onSessionAttached).toHaveBeenCalledWith("agent-1", "sess-auto-created")
    })

    it("also reports for an injected-ready host (call sits after the if block, not inside)", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const onSessionAttached = vi.fn()
      const mockHost = makeMockHost("injected-session")

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
        onSessionAttached,
      })

      await registry.getOrCreateHost("agent-1")

      expect(mockHost.newSession).not.toHaveBeenCalled()
      expect(onSessionAttached).toHaveBeenCalledTimes(1)
      expect(onSessionAttached).toHaveBeenCalledWith("agent-1", "injected-session")
    })

    it("a throwing onSessionAttached does not fail host creation (warn + continue)", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeAutoSessionHost()

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
        onSessionAttached: vi.fn().mockRejectedValue(new Error("agents registry down")),
      })

      const result = await registry.getOrCreateHost("agent-1")

      expect(result?.host).toBe(mockHost)
      expect(registry.getHost("agent-1")).toBe(mockHost)
    })

    it("notifySessionAttached delegates to the callback; without a callback it is a quiet no-op", async () => {
      const onSessionAttached = vi.fn()
      const registry = createAgentSessionRegistry({
        connectionRegistry: makeMockConnectionRegistry(),
        onSessionAttached,
      })

      await registry.notifySessionAttached("agent-9", "sess-9")
      expect(onSessionAttached).toHaveBeenCalledWith("agent-9", "sess-9")

      const bare = createAgentSessionRegistry({
        connectionRegistry: makeMockConnectionRegistry(),
      })
      await expect(bare.notifySessionAttached("agent-9", "sess-9")).resolves.toBeUndefined()
    })

    it("M5 unaffected: two concurrent callers → callback called exactly once", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeAutoSessionHost()
      // real async work — wide enough for a second caller to race in without the M5 guard
      const createHostFn = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(mockHost), 0)))
      const onSessionAttached = vi.fn()

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: createHostFn,
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
        onSessionAttached,
      })

      const [r1, r2] = await Promise.all([
        registry.getOrCreateHost("agent-1"),
        registry.getOrCreateHost("agent-1"),
      ])

      expect(onSessionAttached).toHaveBeenCalledTimes(1)
      expect(onSessionAttached).toHaveBeenCalledWith("agent-1", "sess-auto-created")
      expect(r1).toBe(r2)
    })
  })

  // ─── slice remote-warm-reconnect C2: guard host→WS ─────────────────────────

  describe("attached-agent refusal (slice remote-warm-reconnect C2)", () => {
    it("refuses to create a host for a WS-owned agent (WS holds the wire)", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn, /* attached */ true)
      const createHostFn = vi.fn().mockResolvedValue(makeMockHost())

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: createHostFn,
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      const result = await registry.getOrCreateHost("agent-1")

      expect(result).toBeUndefined() // → route יחזיר 404
      expect(createHostFn).not.toHaveBeenCalled() // host לא נוצר בכלל
      expect(registry.getHost("agent-1")).toBeUndefined()
    })

    it("creates a host normally when the agent is not attached (regression)", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn, /* attached */ false)
      const mockHost = makeMockHost()

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      const result = await registry.getOrCreateHost("agent-1")

      expect(result?.host).toBe(mockHost)
    })
  })

  // ─── slice remote-warm-reconnect C2b: liveness (אין hosts יתומים) ──────────

  describe("liveness check (slice remote-warm-reconnect C2b)", () => {
    it("dead connection → getOrCreateHost returns undefined AND clears the stale entry", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost()

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      // host נוצר בזמן שה-connection חי
      await registry.getOrCreateHost("agent-1")
      expect(registry.getHost("agent-1")).toBe(mockHost)

      // ה-connection מת (crash/DELETE) — connectionRegistry.get מחזיר undefined
      ;(connectionRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

      await expect(registry.getOrCreateHost("agent-1")).resolves.toBeUndefined()
      // ה-entry נמחק מהמפה — לא נשאר host יתום
      expect(registry.getHost("agent-1")).toBeUndefined()
      expect(registry.getBroadcaster("agent-1")).toBeUndefined()
    })

    it("after dead-conn cleanup, a revived connection gets a fresh host", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const firstHost = makeMockHost()
      const secondHost = makeMockHost()
      const createHostFn = vi
        .fn()
        .mockResolvedValueOnce(firstHost)
        .mockResolvedValueOnce(secondHost)

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: createHostFn,
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await registry.getOrCreateHost("agent-1")
      ;(connectionRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined)
      await registry.getOrCreateHost("agent-1") // מנקה את ה-entry המת

      // connection חוזר — נוצר host חדש (לא הישן-המת)
      ;(connectionRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(conn)
      const result = await registry.getOrCreateHost("agent-1")

      expect(result?.host).toBe(secondHost)
      expect(createHostFn).toHaveBeenCalledTimes(2)
    })
  })

  // ─── slice ownership-truth C2: host registers/releases ownership ──────────

  describe("ownership registration (slice ownership-truth C2)", () => {
    it("doCreate marks ownership as http after successful host creation", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn, /* attached */ false)
      const markOwnedSpy = connectionRegistry.markOwned as ReturnType<typeof vi.fn>

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(makeMockHost()),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await registry.getOrCreateHost("agent-own-1")

      expect(markOwnedSpy).toHaveBeenCalledWith("agent-own-1", "http")
    })

    it("unregisterHost calls markDetached when owner is http", () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      // Simulate http ownership
      ;(connectionRegistry.getOwner as ReturnType<typeof vi.fn>).mockReturnValue({
        via: "http",
        since: Date.now(),
      })
      const markDetachedSpy = connectionRegistry.markDetached as ReturnType<typeof vi.fn>

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(makeMockHost()),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      // Create then unregister
      // Need to set map entry — use getOrCreateHost
      // But we need isOwnedByWs=false for creation to succeed (already set via attached=false)
      // Actually the mock's isOwnedByWs returns attached (false), so creation succeeds
      // But markOwned is a mock — it doesn't actually set owner. So getOwner mock is what matters.
      // We already set getOwner to return http. After unregister:
      registry.unregisterHost("test-agent")

      expect(markDetachedSpy).toHaveBeenCalledWith("test-agent")
    })

    it("unregisterHost does NOT call markDetached when owner is ws (not http)", () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      // Simulate WS ownership — unregisterHost should NOT clear it
      ;(connectionRegistry.getOwner as ReturnType<typeof vi.fn>).mockReturnValue({
        via: "ws",
        since: Date.now(),
      })
      const markDetachedSpy = connectionRegistry.markDetached as ReturnType<typeof vi.fn>

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(makeMockHost()),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      registry.unregisterHost("test-agent-ws")

      expect(markDetachedSpy).not.toHaveBeenCalled()
    })

    it("unregisterHost does NOT call markDetached when owner is null", () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      // getOwner already returns null by default
      const markDetachedSpy = connectionRegistry.markDetached as ReturnType<typeof vi.fn>

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(makeMockHost()),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      registry.unregisterHost("test-agent-null")

      expect(markDetachedSpy).not.toHaveBeenCalled()
    })
  })
})

// ─── slice handoff-foundations C3: reservation + rollback ─────────────────────

describe("AgentSessionRegistry — reservation + rollback (handoff-foundations C3)", () => {
  // DoD 7: isHeld returns true during the creation window (in-flight)
  it("isHeld returns true while getOrCreateHost is in-flight (creation window)", async () => {
    const conn = makeMockConnection()
    const connectionRegistry = makeMockConnectionRegistry(conn)
    const mockHost = makeMockHost(null)
    // Delay host creation so we can check isHeld during the window
    let resolveCreate!: () => void
    const createHostFn = vi.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        resolveCreate = () => resolve(mockHost)
      })
    })

    const registry = createAgentSessionRegistry({
      connectionRegistry,
      _createHostFn: createHostFn,
      _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
    })

    // Start creation — don't await yet
    const createPromise = registry.getOrCreateHost("agent-1")

    // Flush microtasks so the promise is in-flight
    await Promise.resolve()

    // isHeld must be true during the creation window
    expect(registry.isHeld("agent-1")).toBe(true)

    // Complete creation
    resolveCreate!()
    await createPromise

    // After creation, isHeld is still true (host is in the map now)
    expect(registry.isHeld("agent-1")).toBe(true)
  })

  it("isHeld returns false for an unknown agentId", () => {
    const registry = createAgentSessionRegistry({
      connectionRegistry: makeMockConnectionRegistry(),
    })
    expect(registry.isHeld("unknown")).toBe(false)
  })

  it("isHeld returns false after unregisterHost", async () => {
    const conn = makeMockConnection()
    const connectionRegistry = makeMockConnectionRegistry(conn)
    const registry = createAgentSessionRegistry({
      connectionRegistry,
      _createHostFn: vi.fn().mockResolvedValue(makeMockHost()),
      _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
    })

    await registry.getOrCreateHost("agent-1")
    expect(registry.isHeld("agent-1")).toBe(true)

    registry.unregisterHost("agent-1")
    expect(registry.isHeld("agent-1")).toBe(false)
  })

  // DoD 8: rollback calls host.dispose() on newSession failure
  it("rollback calls host.dispose() when newSession fails (not just inFlight cleanup)", async () => {
    const conn = makeMockConnection()
    const connectionRegistry = makeMockConnectionRegistry(conn)
    const mockHost = makeMockHost(null)
    // newSession fails — simulates a real ACP session creation failure
    ;(mockHost.newSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("newSession failed"))

    const disposeSpy = mockHost.dispose as ReturnType<typeof vi.fn>

    const registry = createAgentSessionRegistry({
      connectionRegistry,
      _createHostFn: vi.fn().mockResolvedValue(mockHost),
      _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
    })

    await expect(registry.getOrCreateHost("agent-1")).rejects.toThrow("newSession failed")

    // The host was disposed — crash subscription removed, patches terminated
    expect(disposeSpy).toHaveBeenCalledTimes(1)

    // isHeld is false — the reservation was cleaned up
    expect(registry.isHeld("agent-1")).toBe(false)
    expect(registry.getHost("agent-1")).toBeUndefined()
  })

  // DoD 9: inFlight still works — two concurrent callers create exactly one host
  it("inFlight still works: two concurrent calls create exactly one host (regression)", async () => {
    const conn = makeMockConnection()
    const connectionRegistry = makeMockConnectionRegistry(conn)
    const mockHost = makeMockHost(null)
    const createHostFn = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(mockHost), 0)))

    const registry = createAgentSessionRegistry({
      connectionRegistry,
      _createHostFn: createHostFn,
      _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
    })

    const [r1, r2] = await Promise.all([
      registry.getOrCreateHost("agent-1"),
      registry.getOrCreateHost("agent-1"),
    ])

    expect(createHostFn).toHaveBeenCalledTimes(1)
    expect(mockHost.newSession).toHaveBeenCalledTimes(1)
    expect(r1).toBe(r2)
    expect(r1?.host).toBe(mockHost)
  })
})
