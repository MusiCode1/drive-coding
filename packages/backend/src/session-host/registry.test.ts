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
import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import { createInMemoryAgentRegistry } from "../agents/registry.js"
import { buildAgentMcpServers } from "../agent-identity.js"
import { setSelfBaseUrlForTests } from "../instances.js"
import { registerRpcRoute } from "./http/rpc.js"
import type { PatchesBroadcaster } from "./patches-broadcaster.js"
import type { HostEntry, HostResult } from "./registry.js"
import { createAgentSessionRegistry, resolveHttpOwnerTtlMs } from "./registry.js"
import type { ExtendedSessionHost } from "./session-host.js"

// slice host-result-reason C1: getOrCreateHost now returns a discriminated
// HostResult instead of HostEntry | undefined. Most existing tests only care
// about the success path — unwrap() throws with the reason on failure so a
// regression surfaces as a clear assertion error instead of `undefined.host`.
function unwrap(result: HostResult): HostEntry {
  if (!result.ok) throw new Error(`expected ok:true, got {ok:false, reason:"${result.reason}"}`)
  return result.entry
}

const TEST_SELF_BASE = "http://127.0.0.1:4055"

beforeEach(() => {
  setSelfBaseUrlForTests(TEST_SELF_BASE)
})

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
  owner: { via: "ws" | "http"; since: number } | null = null,
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
    getOwner: vi.fn().mockReturnValue(owner),
    getEpoch: vi.fn().mockReturnValue(0),
    isOwnedByWs: vi.fn().mockReturnValue(attached),
    getRuntimeInfo: vi.fn().mockReturnValue(null),
    getCliKind: vi.fn().mockReturnValue("opencode"),
    close: vi.fn().mockResolvedValue(undefined),
    onCrash: vi.fn(() => () => {}),
  } as unknown as ConnectionRegistry
}

/**
 * makeStatefulConnReg — slice ttl-ownership: a REAL-behaving connection-registry
 * fake, needed because after the fix the sweep's loop guard (`via === "http"`)
 * runs on EVERY pass, and the static `makeMockConnectionRegistry` mock never
 * changes what `getOwner`/`getLastSeenAt` return — so a sweep that fires 15
 * times over `advanceTimersByTimeAsync(300)` would call `broadcaster.close()`
 * 15 times, and `toHaveBeenCalledTimes(1)` would fail on a CORRECT
 * implementation. This fake tracks real state: markOwned sets an owner (and
 * bumps epoch + lastSeenAt), markDetached clears it, getOwner/getLastSeenAt
 * read it back (getLastSeenAt is null when there's no owner — the real
 * semantics in connection-registry.ts, and what makes the sweep's
 * `if (lastSeen === null) continue` guard actually mean something here).
 */
function makeStatefulConnReg(conn: ProviderConnection) {
  let owner: { via: "ws" | "http"; since: number } | null = null
  let lastSeenAt: number | null = Date.now() - 10_000 // starts stale
  let epoch = 0
  const markOwned = vi.fn((_id: string, via: "ws" | "http") => {
    owner = { via, since: Date.now() }
    epoch++
    lastSeenAt = Date.now()
  })
  const markDetached = vi.fn(() => {
    owner = null
  })
  const reg = {
    // 🔴 this spread is mandatory, not a convenience. doCreate also calls
    // `get`, `isOwnedByWs`, `getCwd` (and `getCliKind` on the error path) —
    // without them all six new tests fail on `TypeError:
    // connectionRegistry.get is not a function` on the very first line, and
    // `as unknown as` hides this from typecheck.
    ...makeMockConnectionRegistry(conn),
    markOwned,
    markDetached,
    getOwner: vi.fn(() => owner),
    getLastSeenAt: vi.fn(() => (owner ? lastSeenAt : null)),
    touchOwner: vi.fn(() => {
      if (owner) lastSeenAt = Date.now()
    }),
    getEpoch: vi.fn(() => epoch),
  } as unknown as ConnectionRegistry
  return { reg, markOwned, markDetached }
}

function makeMockHost(sessionId: string | null = null): ExtendedSessionHost {
  const patches = new ReadableStream<import("@drive-coding/core/session").Patch>({
    start() {},
  })
  const host: ExtendedSessionHost = {
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
    isScopeRequest: () => false,
    requestScopePermission: vi.fn().mockResolvedValue("deny"),
    listSessions: vi.fn().mockResolvedValue({}),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    agentCapabilities: { mcpCapabilities: { http: true } },
  }
  return host
}

function makeMockBroadcaster(): PatchesBroadcaster {
  return {
    subscribe: vi.fn().mockReturnValue(new ReadableStream()),
    unsubscribe: vi.fn(),
    close: vi.fn(),
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
    it("returns {ok:false, reason:'not-found'} if connection not found in connectionRegistry", async () => {
      const connectionRegistry = makeMockConnectionRegistry(undefined)
      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn(),
        _createBroadcasterFn: vi.fn(),
      })

      const result = await registry.getOrCreateHost("missing-agent")
      expect(result).toEqual({ ok: false, reason: "not-found" })
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

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("expected ok:true")
      expect(result.entry.host).toBe(mockHost)
      expect(result.entry.broadcaster).toBe(mockBroadcaster)
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

    // 🔴 slice ttl-ownership: mutated. `dispose` is no longer called on expiry
    // (holder is retained) — the signal moves to `markDetached`/`broadcaster.close`.
    it("http liveness: stale owner is released (markDetached + broadcaster.close), agent NOT killed", async () => {
      vi.useFakeTimers()
      try {
        const conn = makeMockConnection()
        // נראה לאחרונה הרבה לפני ה-TTL ⇒ פקוע
        const touchState = makeTouchState(Date.now() - 10_000)
        const connectionRegistry = makeMockConnectionRegistry(conn, false, touchState, {
          via: "http",
          since: Date.now(),
        })
        const mockHost = makeMockHost()
        const broadcaster = makeMockBroadcaster()

        const registry = createAgentSessionRegistry({
          connectionRegistry,
          _createHostFn: vi.fn().mockResolvedValue(mockHost),
          _createBroadcasterFn: vi.fn().mockReturnValue(broadcaster),
          _httpOwnerTtlMs: 100,
          _httpSweepMs: 20,
        })

        await registry.getOrCreateHost("agent-1")
        expect(registry.isHeld("agent-1")).toBe(true)

        await vi.advanceTimersByTimeAsync(300)

        // הבעלות שוחררה והצינור פונה — אבל host.dispose לעולם לא נקרא (הוא נשמר)
        expect(mockHost.dispose).not.toHaveBeenCalled()
        expect(connectionRegistry.markDetached).toHaveBeenCalled()
        expect(broadcaster.close).toHaveBeenCalled()
        // 🔴 הגבול הקשיח — הסוכן חי
        expect(conn.close).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    // ⚠️ הטסט הזה חייב להיכשל אם touchOwner הוא no-op — לכן ה-mock מחזיק מצב
    // אמיתי, ומתחיל **פקוע**. רק ה-touch מציל אותו. (כלב NO-GO)
    // 🔴 slice ttl-ownership: mutated. `dispose.not.toHaveBeenCalled()` passes
    // vacuously now (dispose is never called on expiry) — replaced with the
    // two assertions that actually detect a stale-but-touched owner being evicted.
    it("http liveness: touchOwner keeps the owner alive past the TTL", async () => {
      vi.useFakeTimers()
      try {
        const conn = makeMockConnection()
        const touchState = makeTouchState(Date.now() - 10_000) // מתחיל פקוע
        const connectionRegistry = makeMockConnectionRegistry(conn, false, touchState, {
          via: "http",
          since: Date.now(),
        })
        const mockHost = makeMockHost()
        const broadcaster = makeMockBroadcaster()

        const registry = createAgentSessionRegistry({
          connectionRegistry,
          _createHostFn: vi.fn().mockResolvedValue(mockHost),
          _createBroadcasterFn: vi.fn().mockReturnValue(broadcaster),
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

        expect(connectionRegistry.markDetached).not.toHaveBeenCalled()
        expect(broadcaster.close).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    // 🔴 DoD 7 — slice liveness C1 §2.1: הסויפ המאוחד **לעולם לא** מפנה בעלי-WS.
    // גם אם ה-WS לא דיווח 200ש׳ (lastSeen פקוע) — ה-WS הוא סימן-החיים של עצמו
    // (sweep של סוקטים ב-ws-agent.ts, תפקיד נפרד). בלי בדיקת-התעבורה המפורשת
    // (getOwner().via !== "http") הטסט הזה היה נכשל — touchOwner אגנוסטי גרם
    // ל-getLastSeenAt להחזיר מספר גם ל-WS. (mutant 21ב).
    // 🔴 slice ttl-ownership: mutated — same replacement as the two tests above.
    it("🔴 sweep does NOT evict a WS owner even with a stale stamp", async () => {
      vi.useFakeTimers()
      try {
        const conn = makeMockConnection()
        const touchState = makeTouchState(Date.now() - 10_000) // פקוע
        // attached=false ⇒ יצירת ה-host מותרת; owner={via:"ws"} ⇒ הסויפ חייב לדלג
        // על בעל-ה-WS הזה (הבדיקה המפורשת של התעבורה, §2.1).
        const connectionRegistry = makeMockConnectionRegistry(conn, false, touchState, {
          via: "ws",
          since: Date.now(),
        })
        const mockHost = makeMockHost()
        const broadcaster = makeMockBroadcaster()

        const registry = createAgentSessionRegistry({
          connectionRegistry,
          _createHostFn: vi.fn().mockResolvedValue(mockHost),
          _createBroadcasterFn: vi.fn().mockReturnValue(broadcaster),
          _httpOwnerTtlMs: 100,
          _httpSweepMs: 20,
        })

        await registry.getOrCreateHost("agent-1")

        await vi.advanceTimersByTimeAsync(300)

        expect(connectionRegistry.markDetached).not.toHaveBeenCalled()
        expect(broadcaster.close).not.toHaveBeenCalled()
        expect(registry.getHost("agent-1")).toBe(mockHost)
      } finally {
        vi.useRealTimers()
      }
    })

    // ─── slice ttl-ownership Commit 1: expiry releases ownership, keeps holder ───

    it("TTL expiry releases ownership but KEEPS the holder — host, broadcaster and state survive", async () => {
      vi.useFakeTimers()
      try {
        const conn = makeMockConnection()
        const { reg: connectionRegistry, markDetached } = makeStatefulConnReg(conn)
        const mockHost = makeMockHost()
        const broadcaster = makeMockBroadcaster()

        const registry = createAgentSessionRegistry({
          connectionRegistry,
          _createHostFn: vi.fn().mockResolvedValue(mockHost),
          _createBroadcasterFn: vi.fn().mockReturnValue(broadcaster),
          _httpOwnerTtlMs: 100,
          _httpSweepMs: 20,
        })

        await registry.getOrCreateHost("agent-1")

        await vi.advanceTimersByTimeAsync(300)

        expect(mockHost.dispose).not.toHaveBeenCalled()
        expect(registry.getHost("agent-1")).toBe(mockHost)
        expect(registry.getBroadcaster("agent-1")).toBe(broadcaster)
        // ⚠️ this is the handle makeStatefulConnReg returns (`const { reg,
        // markOwned, markDetached } = makeStatefulConnReg(conn)`), NOT
        // `connectionRegistry.markDetached`.
        expect(markDetached).toHaveBeenCalled()
        expect(conn.close).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it("TTL expiry severs abandoned SSE subscribers (broadcaster.close) without ending the source", async () => {
      vi.useFakeTimers()
      try {
        const conn = makeMockConnection()
        const { reg: connectionRegistry } = makeStatefulConnReg(conn)
        const mockHost = makeMockHost()
        const broadcaster = makeMockBroadcaster()

        const registry = createAgentSessionRegistry({
          connectionRegistry,
          _createHostFn: vi.fn().mockResolvedValue(mockHost),
          _createBroadcasterFn: vi.fn().mockReturnValue(broadcaster),
          _httpOwnerTtlMs: 100,
          _httpSweepMs: 20,
        })

        await registry.getOrCreateHost("agent-1")

        await vi.advanceTimersByTimeAsync(300)

        expect(broadcaster.close).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it("a reconnect after expiry is a continuation — same host, no second session init", async () => {
      vi.useFakeTimers()
      try {
        const conn = makeMockConnection()
        const { reg: connectionRegistry } = makeStatefulConnReg(conn)
        const mockHost = makeMockHost()
        const createHostFn = vi.fn().mockResolvedValue(mockHost)

        const registry = createAgentSessionRegistry({
          connectionRegistry,
          _createHostFn: createHostFn,
          _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
          _httpOwnerTtlMs: 100,
          _httpSweepMs: 20,
        })

        await registry.getOrCreateHost("agent-1")
        await vi.advanceTimersByTimeAsync(300) // expiry

        const again = await registry.getOrCreateHost("agent-1")

        expect(unwrap(again).host).toBe(mockHost)
        expect(createHostFn).toHaveBeenCalledTimes(1)
        expect(mockHost.loadSession).not.toHaveBeenCalled()
        expect(mockHost.newSession).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it("a reconnect after expiry re-claims http ownership (markOwned), and a further reconnect while owned does not", async () => {
      vi.useFakeTimers()
      try {
        const conn = makeMockConnection()
        // ⚠️ needs a STATEFUL getOwner (not the static `.mockReturnValue`
        // helper) — markOwned writes, markDetached clears, getOwner reads.
        const { reg: connectionRegistry, markOwned } = makeStatefulConnReg(conn)
        const mockHost = makeMockHost()

        const registry = createAgentSessionRegistry({
          connectionRegistry,
          _createHostFn: vi.fn().mockResolvedValue(mockHost),
          _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
          _httpOwnerTtlMs: 100,
          _httpSweepMs: 20,
        })

        await registry.getOrCreateHost("agent-1") // 1st markOwned (doCreate)
        await vi.advanceTimersByTimeAsync(300) // expiry — releases ownership

        await registry.getOrCreateHost("agent-1") // 2nd connection — re-claims
        // ⚠️ passes even without the fix — doCreate itself calls markOwned.
        // Positive control, not the detector.
        expect(markOwned).toHaveBeenCalledWith("agent-1", "http")

        // 🔴 the actual detector of mutation 4: a THIRD connection right after
        // the second, with NO advanceTimersByTimeAsync in between (that would
        // let the sweep evict again and inflate the count to 3).
        await registry.getOrCreateHost("agent-1")
        expect(markOwned).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it("the sweep fires at most once per expiry (markDetached makes the next pass skip)", async () => {
      vi.useFakeTimers()
      try {
        const conn = makeMockConnection()
        const { reg: connectionRegistry } = makeStatefulConnReg(conn)
        const mockHost = makeMockHost()
        const broadcaster = makeMockBroadcaster()

        const registry = createAgentSessionRegistry({
          connectionRegistry,
          _createHostFn: vi.fn().mockResolvedValue(mockHost),
          _createBroadcasterFn: vi.fn().mockReturnValue(broadcaster),
          _httpOwnerTtlMs: 100,
          _httpSweepMs: 20,
        })

        await registry.getOrCreateHost("agent-1")

        await vi.advanceTimersByTimeAsync(300) // ≥10 sweep passes

        expect(broadcaster.close).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it("POST /rpc re-claims ownership after expiry — through the real route, not the registry API", async () => {
      vi.useFakeTimers()
      try {
        const conn = makeMockConnection()
        const { reg: connectionRegistry, markOwned } = makeStatefulConnReg(conn)
        const mockHost = makeMockHost()

        const registry = createAgentSessionRegistry({
          connectionRegistry,
          _createHostFn: vi.fn().mockResolvedValue(mockHost),
          _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
          _httpOwnerTtlMs: 100,
          _httpSweepMs: 20,
        })

        await registry.getOrCreateHost("agent-1")
        await vi.advanceTimersByTimeAsync(300) // expiry — ownership released

        const app = new Hono()
        registerRpcRoute(app, registry, createInMemoryAgentRegistry())
        const res = await app.request(`/api/agents/agent-1/rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "listSessions" }),
        })

        expect(res.status).toBe(200)
        expect(markOwned).toHaveBeenCalledWith("agent-1", "http")
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
      // slice host-result-reason C1: getOrCreateHost now wraps the cached entry
      // in a fresh {ok:true, entry} literal on every call (so `.ok`/`.entry` stay
      // ergonomic for callers) — the wrapper object is no longer the same
      // reference, but the underlying entry (host+broadcaster) MUST still be,
      // proving no re-creation happened.
      expect(unwrap(first)).toBe(unwrap(second))
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

      expect(unwrap(r1).host).not.toBe(unwrap(r2).host)
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
      expect(unwrap(r1).host).toBe(mockHost)
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

      expect(mockHost.newSession).toHaveBeenCalledWith({
        cwd: "/tmp/mock-cwd",
        mcpServers: buildAgentMcpServers("agent-1", TEST_SELF_BASE),
      })
      expect(connectionRegistry.getCwd).toHaveBeenCalledWith("agent-1")
    })

    it("omits mcpServers when agent did not declare http MCP in initialize", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const mockHost = makeMockHost(null)
      ;(mockHost as unknown as { agentCapabilities: unknown }).agentCapabilities = {}

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      await registry.getOrCreateHost("agent-1")

      expect(mockHost.newSession).toHaveBeenCalledWith({ cwd: "/tmp/mock-cwd" })
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

    // slice sse-liveness Commit 3: the actual DoD — before this, unregisterHost
    // only ever did map.delete(); nothing terminated the SSE stream for the two
    // call sites (deleteAndKill, the crash handler) that never call
    // host.dispose() first. Without a real broadcaster in the loop this test
    // would pass "by construction" (a mocked close() always succeeds) — its
    // value is asserting the CALL happened at all, which the pre-fix code
    // never did.
    it("closes the broadcaster (terminates the SSE stream) — this is the DoD, not just map removal", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn)
      const broadcaster = makeMockBroadcaster()

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(makeMockHost()),
        _createBroadcasterFn: vi.fn().mockReturnValue(broadcaster),
      })

      await registry.getOrCreateHost("agent-1")
      expect(broadcaster.close).not.toHaveBeenCalled()

      registry.unregisterHost("agent-1")
      expect(broadcaster.close).toHaveBeenCalledTimes(1)
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

    it("calls onSessionAttached with (agentId, real host sessionId, cwd) on first creation", async () => {
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
      // slice agent-patch-unify C2: cwd (מ-connectionRegistry.getCwd, כבר בהיקף
      // כאן — נעשה בו שימוש ל-host.newSession/loadSession) עובר גם ל-callback.
      expect(onSessionAttached).toHaveBeenCalledWith(
        "agent-1",
        "sess-auto-created",
        "/tmp/mock-cwd",
      )
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
      expect(onSessionAttached).toHaveBeenCalledWith("agent-1", "injected-session", "/tmp/mock-cwd")
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

      expect(unwrap(result).host).toBe(mockHost)
      expect(registry.getHost("agent-1")).toBe(mockHost)
    })

    it("notifySessionAttached delegates to the callback (incl. cwd); without a callback it is a quiet no-op", async () => {
      const onSessionAttached = vi.fn()
      const registry = createAgentSessionRegistry({
        connectionRegistry: makeMockConnectionRegistry(),
        onSessionAttached,
      })

      // slice agent-patch-unify C2: rpc.ts case "loadSession" מעביר את ה-cwd
      // שכבר חושב שם — הפרמטר השלישי כאן הוא הנתיב של אותה שרשרת.
      await registry.notifySessionAttached("agent-9", "sess-9", "/some/cwd")
      expect(onSessionAttached).toHaveBeenCalledWith("agent-9", "sess-9", "/some/cwd")

      // בלי cwd (הענף הישן, ללא שינוי) — נשאר undefined, לא הופך למחרוזת ריקה.
      await registry.notifySessionAttached("agent-9", "sess-9")
      expect(onSessionAttached).toHaveBeenCalledWith("agent-9", "sess-9", undefined)

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
      expect(onSessionAttached).toHaveBeenCalledWith(
        "agent-1",
        "sess-auto-created",
        "/tmp/mock-cwd",
      )
      expect(r1).toBe(r2)
    })
  })

  // ─── slice remote-warm-reconnect C2: guard host→WS ─────────────────────────

  describe("attached-agent refusal (slice remote-warm-reconnect C2)", () => {
    it("refuses to create a host for a WS-owned agent (WS holds the wire) — reason:'ws-owned'", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn, /* attached */ true)
      const createHostFn = vi.fn().mockResolvedValue(makeMockHost())

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: createHostFn,
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
      })

      const result = await registry.getOrCreateHost("agent-1")

      // slice host-result-reason C1: no evictionController injected here — the
      // final ("no takeover possible") ws-owned reason, mapped to 404 by callers.
      expect(result).toEqual({ ok: false, reason: "ws-owned" })
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

      expect(unwrap(result).host).toBe(mockHost)
    })
  })

  // ─── slice host-result-reason C1: evict-timeout is TRANSIENT, distinct from ws-owned ───

  describe("evict-timeout (slice host-result-reason C1)", () => {
    it("evictAndWait rejecting → {ok:false, reason:'evict-timeout'} (NOT ws-owned, NOT 404-equivalent)", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn, /* attached */ true)
      const createHostFn = vi.fn().mockResolvedValue(makeMockHost())
      const evictAndWait = vi.fn().mockRejectedValue(new Error("evict timed out"))

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: createHostFn,
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
        evictionController: { evictAndWait },
      })

      const result = await registry.getOrCreateHost("agent-1")

      expect(result).toEqual({ ok: false, reason: "evict-timeout" })
      expect(evictAndWait).toHaveBeenCalledWith("agent-1", 4409)
      expect(createHostFn).not.toHaveBeenCalled() // never got past the failed eviction
    })

    it("evictAndWait resolving → HTTP takeover proceeds normally (regression: injecting the controller does not break the happy path)", async () => {
      const conn = makeMockConnection()
      const connectionRegistry = makeMockConnectionRegistry(conn, /* attached */ true)
      const mockHost = makeMockHost()
      const evictAndWait = vi.fn().mockResolvedValue(undefined)

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
        evictionController: { evictAndWait },
      })

      const result = await registry.getOrCreateHost("agent-1")

      expect(evictAndWait).toHaveBeenCalledWith("agent-1", 4409)
      expect(unwrap(result).host).toBe(mockHost)
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

      // slice host-result-reason C1: FINAL — reason:"conn-dead", never evict-timeout
      await expect(registry.getOrCreateHost("agent-1")).resolves.toEqual({
        ok: false,
        reason: "conn-dead",
      })
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

      expect(unwrap(result).host).toBe(secondHost)
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
    ;(mockHost.newSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("newSession failed"),
    )

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
    expect(unwrap(r1).host).toBe(mockHost)
  })
})

// ─── slice ttl-ownership Commit 2: HTTP_OWNER_TTL_MS from env ────────────────

describe("resolveHttpOwnerTtlMs", () => {
  const cases: Array<[string | undefined, number]> = [
    [undefined, 600_000],
    ["", 600_000],
    ["   ", 600_000],
    ["abc", 600_000],
    ["0", 600_000],
    ["-5", 600_000],
    ["Infinity", 600_000],
    ["5000", 5000],
    ["1.5e4", 15000],
  ]

  for (const [raw, expected] of cases) {
    it(`resolveHttpOwnerTtlMs(${JSON.stringify(raw)}) → ${expected}`, () => {
      expect(resolveHttpOwnerTtlMs(raw)).toBe(expected)
    })
  }

  // 🔴 default path: NO _httpOwnerTtlMs injected — the sweep must honour
  // process.env.HTTP_OWNER_TTL_MS directly. Run-1's lesson (`Illegal
  // invocation`) was a suite of green tests that all injected a mock and
  // never once ran the default path.
  it("🔴 default path: with no _httpOwnerTtlMs, the sweep honours HTTP_OWNER_TTL_MS from the env", async () => {
    vi.useFakeTimers()
    const prev = process.env.HTTP_OWNER_TTL_MS
    process.env.HTTP_OWNER_TTL_MS = "50"
    try {
      const conn = makeMockConnection()
      const touchState = makeTouchState(Date.now() - 10_000) // already stale
      const connectionRegistry = makeMockConnectionRegistry(conn, false, touchState, {
        via: "http",
        since: Date.now(),
      })
      const mockHost = makeMockHost()

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
        _httpSweepMs: 20, // only the TTL comes from env — sweep interval still injected
      })

      await registry.getOrCreateHost("agent-1")
      await vi.advanceTimersByTimeAsync(300)

      expect(connectionRegistry.markDetached).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      if (prev === undefined) delete process.env.HTTP_OWNER_TTL_MS
      else process.env.HTTP_OWNER_TTL_MS = prev
    }
  })

  // 🔴 the guard against "an accidentally tiny default" — a mutation of
  // DEFAULT_HTTP_OWNER_TTL_MS to 600 MUST fail this.
  it("🔴 default path: with the env unset, the default is 600_000 (a 100s-stale owner is NOT released)", async () => {
    vi.useFakeTimers()
    const prev = process.env.HTTP_OWNER_TTL_MS
    delete process.env.HTTP_OWNER_TTL_MS
    try {
      const conn = makeMockConnection()
      const touchState = makeTouchState(Date.now() - 100_000)
      const connectionRegistry = makeMockConnectionRegistry(conn, false, touchState, {
        via: "http",
        since: Date.now(),
      })
      const mockHost = makeMockHost()

      const registry = createAgentSessionRegistry({
        connectionRegistry,
        _createHostFn: vi.fn().mockResolvedValue(mockHost),
        _createBroadcasterFn: vi.fn().mockReturnValue(makeMockBroadcaster()),
        _httpSweepMs: 20,
      })

      await registry.getOrCreateHost("agent-1")
      await vi.advanceTimersByTimeAsync(300)

      expect(connectionRegistry.markDetached).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      if (prev === undefined) delete process.env.HTTP_OWNER_TTL_MS
      else process.env.HTTP_OWNER_TTL_MS = prev
    }
  })
})
