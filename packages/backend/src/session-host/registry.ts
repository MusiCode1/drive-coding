/**
 * registry.ts — AgentSessionRegistry (S4 C1).
 *
 * Maps agentId → {host: ExtendedSessionHost, broadcaster: PatchesBroadcaster}.
 * Lazy creation: host + broadcaster are created on first getOrCreateHost call.
 *
 * Receives connectionRegistry in constructor — used to look up ProviderConnection
 * by agentId (connection not found → getOrCreateHost resolves {ok:false, reason:"not-found"};
 * slice host-result-reason C1 — see HostResult below for all four failure reasons).
 *
 * Ownership:
 *   - Registry creates one PatchesBroadcaster per host
 *   - Registry owns the lifecycle of both host and broadcaster
 *
 * Name is "AgentSessionRegistry" to distinguish from the existing `registry`
 * (InMemoryAgentRegistry) already used in server.ts.
 *
 * ─── slice session-host-http C1 (TDD) ───
 *
 * Auto session creation (slice remote-session-view, הכרעה 1, 2026-08-09):
 * ה-FE ב-remote mode אסור לו ליזום newSession/loadSession (הbackend מנהל sessions,
 * §5.1). לכן ברגע שה-host נוצר (lazy, בקריאה הראשונה) — הוא מקבל session אוטומטית
 * מ-host.newSession({cwd}), כך שה-snapshot הראשון שה-SSE שולח כבר נושא sessionId
 * אמיתי. cwd מגיע מ-connectionRegistry.getCwd(agentId) (נשמר ב-connect() המקורי).
 *
 * In-flight memoization (calev-heavy M5, slice remote-session-view fix round 1):
 * getOrCreateHost is async with TWO awaits (_createHostFn + host.newSession) before
 * `map.set` — two concurrent callers for the same agentId (e.g. two browser tabs
 * opening the SSE connection at once) would each race through both awaits, each
 * creating its own host + calling host.newSession() (a real ACP session on the
 * agent!) before either one reaches `map.set`. Measured: hostCreations=3,
 * newSession=3 for 2 concurrent callers, and the SSE stream one caller subscribed
 * to belonged to an orphaned host that never received further patches. Fixed with
 * the same pattern as connection-registry.ts's dedup guard ("no await between the
 * check and the registration") — an agentId → Promise<HostResult> map
 * so concurrent callers share the same in-flight creation.
 */

import { configDefault } from "@drive-coding/core/config/specs"
import { createLogger } from "@drive-coding/core/log"
import type { PermissionPolicyKind } from "@drive-coding/core/types/permission"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import { buildAgentMcpServers, optionalAgentMcpServers } from "../agent-identity.js"
import { getSelfBaseUrl } from "../instances.js"
import { createPatchesBroadcaster, type PatchesBroadcaster } from "./patches-broadcaster.js"
import { buildAgentEventHostOpts } from "./agent-events-registry-opts.js"
import { startAgentStallSweep } from "./agent-events-stall-sweep.js"
import { createSessionHostFromConnection, type ExtendedSessionHost } from "./session-host.js"
import { makePromptCharterHook } from "./session-host-charter.js"

const log = createLogger("backend.session-host.registry")

/**
 * slice remote-warm-reconnect C1: נקרא כש-host מצרף session (יצירה או host מוזרק-מוכן).
 * server.ts מזריק כאן את העדכון לרג'יסטרי הסוכנים (status:"ready" + acpSessionId) —
 * ב-remote mode אף אחד אחר לא כותב acpSessionId (POST /session-attached נקרא רק מנתיבים
 * מקומיים), ובלי זה הסוכן תקוע על status:"starting" וכפתור ה-reconnect disabled.
 */
// slice agent-patch-unify C2: cwd אופציונלי — מגיע משני אתרי-הקריאה (doCreate,
// rpc.ts case "loadSession") שכבר מחזיקים אותו; מאפשר ל-server.ts לעדכן את
// agent.cwd ולתעד ב-projectsRegistry תחת התיקייה הנכונה (§3 — שרשרת ה-cwd).
export type OnSessionAttached = (
  agentId: string,
  sessionId: string,
  cwd?: string,
) => Promise<void> | void

export type HostEntry = {
  host: ExtendedSessionHost
  broadcaster: PatchesBroadcaster
}

/**
 * slice host-result-reason C1: why getOrCreateHost could not return a live
 * HostEntry. Four sources previously collapsed into a single `undefined`
 * (doCreate: no connection / WS-owned without an evictionController / eviction
 * timed out; getOrCreateHost's own liveness check: connection died after the
 * host was created) — and callers translated ALL four to 404 ("agent is
 * gone"). Three of the four ARE final (not-found / ws-owned / conn-dead). Only
 * `evict-timeout` is transient (a stuck WS tab, not a dead agent) — callers
 * map it to 503 instead.
 */
export type HostFailureReason = "not-found" | "conn-dead" | "ws-owned" | "evict-timeout"

export type HostResult = { ok: true; entry: HostEntry } | { ok: false; reason: HostFailureReason }

export type AgentSessionRegistry = {
  /**
   * getHost — returns the existing ExtendedSessionHost for agentId, or undefined.
   * Does NOT create a new host.
   */
  getHost(agentId: string): ExtendedSessionHost | undefined

  /**
   * slice handoff-foundations C3: is the agentId "held" — either a host is
   * already registered (map.has) OR a creation is in-flight (inFlight.has).
   * Visible to WS so it can reject during the creation window, closing the
   * race where WS calls getHost (which only checks map) and gets undefined
   * while doCreate is between the first await and map.set.
   */
  isHeld(agentId: string): boolean
  /**
   * getOrCreateHost — async lazy creation.
   * - If host already exists → returns {ok: true, entry: {host, broadcaster}}
   * - If connection not found in connectionRegistry → {ok: false, reason: "not-found"}
   * - If the existing host's connection died → {ok: false, reason: "conn-dead"}
   * - If WS owns the wire (no evictionController) → {ok: false, reason: "ws-owned"}
   * - If eviction of the WS owner timed out → {ok: false, reason: "evict-timeout"}
   * - Otherwise: creates host + broadcaster, registers them, returns {ok: true, entry}
   */
  getOrCreateHost(agentId: string): Promise<HostResult>

  /**
   * getBroadcaster — returns the existing PatchesBroadcaster for agentId, or undefined.
   */
  getBroadcaster(agentId: string): PatchesBroadcaster | undefined

  /**
   * unregisterHost — removes host + broadcaster for agentId.
   * No-op if agentId is not registered.
   */
  unregisterHost(agentId: string): void

  /**
   * slice remote-warm-reconnect C1: מעביר ל-onSessionAttached שהוזרק (no-op אם לא הוזרק).
   * נחוץ לסלייס ההמשך (loadSession ב-rpc) — שם ה-session נוצר/נטען מחוץ ל-doCreate.
   */
  notifySessionAttached(agentId: string, sessionId: string, cwd?: string): Promise<void>
  /**
   * slice remote-session-mgmt C3: passthrough ל-connectionRegistry.getCwd(agentId).
   * נחוץ ל-loadSession ב-rpc — fallback כש-params.cwd לא נשלח מה-FE.
   */
  getCwd(agentId: string): string | undefined
  /**
   * Passthrough ל-connectionRegistry.getCliKind(agentId).
   * נחוץ ל-session/new ב-rpc — הזרקת _meta של Claude (parity עם FE מקומי).
   */
  getCliKind(agentId: string): string | undefined
  /**
   * slice ownership-handoff C3: passthrough to connectionRegistry.getEpoch(agentId).
   * Returns the ownership generation counter (0 for unknown agentId).
   */
  getEpoch(agentId: string): number
  /**
   * slice connection-set C0: passthrough to connectionRegistry.touchConnection.
   */
  touchConnection(agentId: string, connectionId: string): void
  /**
   * slice liveness C1: passthrough to connectionRegistry.getRuntimeInfo(agentId).
   * Used by POST …/presence to report the agent's runtime state (attached/via/pid)
   * so the FE can detect ownership loss without a second endpoint.
   */
  getRuntimeInfo(agentId: string): {
    pid: number | null
    attached: boolean
    busy: boolean
    lastMessageAt: number | null
    lastSeenAt: number | null
    via: "ws" | "http" | null
  } | null
  getConnectionCount(agentId: string): number

  /** slice boot-layer C2: stop the HTTP ownership TTL sweep interval. */
  stop(): void
}

type AgentSessionRegistryDeps = {
  connectionRegistry: ConnectionRegistry
  /**
   * Injectable for tests — defaults to createSessionHostFromConnection.
   * Receives the ProviderConnection and options, returns Promise<ExtendedSessionHost>.
   * slice ownership-handoff C4: opts includes optional warmReattach for warm path.
   */
  _createHostFn?: (
    conn: ProviderConnection,
    opts?: import("../session-host/session-host.js").SessionHostFromConnOptions,
  ) => Promise<ExtendedSessionHost>
  /**
   * Injectable for tests — defaults to createPatchesBroadcaster.
   * Receives host.patches and returns a PatchesBroadcaster.
   */
  _createBroadcasterFn?: (patches: ExtendedSessionHost["patches"]) => PatchesBroadcaster
  /**
   * slice remote-warm-reconnect C1 (אופציונלי): נקרא בתום doCreate, אחרי ש-session
   * צורף (נוצר או הוזרק-מוכן) — ר' OnSessionAttached. כשל בו נבלע (log.warn):
   * הסשן עצמו עובד; תצוגה ישנה בפאנל עדיפה על חיבור שבור.
   */
  onSessionAttached?: OnSessionAttached
  /**
   * slice ownership-handoff C4: eviction controller — evicts active WS before
   * HTTP host creation, waits for full detach (unsub + unsubCrash).
   * Optional — without it, WS-owned agents return undefined (pre-C4 behavior).
   */
  evictionController?: {
    evictAndWait(agentId: string, code: number, timeoutMs?: number): Promise<void>
  }
  /**
   * slice ownership-handoff C4: resolve acpSessionId for warm reattach.
   * Returns the current ACP session ID for an agent, or undefined for cold start.
   * Injected from server.ts via AgentOrchestrator/AgentRegistry.
   */
  getAcpSessionId?: (agentId: string) => string | undefined
  /**
   * slice session-create-contract: resolve permissionPolicy stored on the agent
   * record at POST /api/agents time — survives lazy host creation.
   */
  getPermissionPolicy?: (
    agentId: string,
  ) => PermissionPolicyKind | undefined | Promise<PermissionPolicyKind | undefined>
  /**
   * slice session-lifecycle-fields C1: closeOnTurnEnd from agent record at create time.
   */
  getCloseOnTurnEnd?: (agentId: string) => boolean | Promise<boolean>
  /** slice session-lifecycle-fields C1: server wires grace timer + deleteAndKill. */
  onScheduleCloseOnTurnEnd?: (agentId: string) => void
  /** slice be-events-subscribe C1 — see buildAgentEventHostOpts */
  onTurnEnded?: Parameters<typeof buildAgentEventHostOpts>[0]["onTurnEnded"]
  /** slice be-events-subscribe C2: stall-suspected callback — must not kill the agent */
  onStallSuspected?: (agentId: string, silentMs: number) => void
  /** slice be-events-subscribe C2: test knobs */
  _stallSweepMs?: number
  _stallSuspectMs?: number
  /**
   * slice ownership-handoff C4b: HTTP ownership TTL (ms).
   * Default: `HTTP_OWNER_TTL_MS` env, else 600_000ms (slice ttl-ownership).
   * Exposed for tests to set a short TTL without real delays.
   */
  _httpOwnerTtlMs?: number
  /**
   * slice ownership-handoff C4b: sweep interval (ms). Default: 30_000ms.
   * Exposed for tests to control sweep timing.
   */
  _httpSweepMs?: number
  /** slice boot-layer C5: env reference for TTL fallback (no direct process.env). */
  env?: NodeJS.ProcessEnv
}

/**
 * resolveHttpOwnerTtlMs — parses HTTP_OWNER_TTL_MS.
 *
 * 🔴 Pure + EXPORTED on purpose: the default path must be executable by a test
 * without any injected seam. Run-1's lesson (`Illegal invocation`) was a suite
 * of 30 green tests that all injected a mock and never once ran the default.
 *
 * Accepts only a finite, strictly-positive number. Anything else — missing,
 * blank, NaN, 0, negative, Infinity — falls back to configDefault("httpOwnerTtlMs").
 */
export function resolveHttpOwnerTtlMs(raw: string | undefined): number {
  const fallback = configDefault("httpOwnerTtlMs")
  if (raw === undefined) return fallback
  const trimmed = raw.trim()
  if (trimmed === "") return fallback
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

export function createAgentSessionRegistry(deps: AgentSessionRegistryDeps): AgentSessionRegistry {
  const {
    connectionRegistry,
    _createHostFn = (conn, opts) => createSessionHostFromConnection(conn, opts),
    _createBroadcasterFn = (patches) => createPatchesBroadcaster(patches),
    evictionController,
    getAcpSessionId,
    getPermissionPolicy,
    getCloseOnTurnEnd,
    onScheduleCloseOnTurnEnd,
    onTurnEnded,
    onStallSuspected,
  } = deps

  const map = new Map<string, HostEntry>()
  // M5: in-flight creation promises — dedups concurrent getOrCreateHost(agentId)
  // callers so only one host + one ACP session get created per agentId.
  const inFlight = new Map<string, Promise<HostResult>>()

  // slice connection-set D8: per-row HTTP TTL sweep — removes stale http rows only.
  const HTTP_OWNER_TTL_MS =
    deps._httpOwnerTtlMs ?? resolveHttpOwnerTtlMs(deps.env?.HTTP_OWNER_TTL_MS)
  const HTTP_SWEEP_MS = deps._httpSweepMs ?? 30_000 // sweep every 30s
  const httpSweep = setInterval(() => {
    const now = Date.now()
    for (const [agentId, entry] of map) {
      for (const row of connectionRegistry.listHttpConnectionIds(agentId)) {
        if (now - row.lastSeenAt <= HTTP_OWNER_TTL_MS) continue
        log.info(
          { agentId, connectionId: row.connectionId, staleMs: now - row.lastSeenAt },
          "HTTP connection stale — removing row (holder retained)",
        )
        if (row.stream !== undefined)
          entry.broadcaster.unsubscribe(row.stream as Parameters<PatchesBroadcaster["unsubscribe"]>[0])
        connectionRegistry.removeConnection(agentId, row.connectionId)
      }
    }
  }, HTTP_SWEEP_MS)
  httpSweep.unref() // don't prevent process exit

  const stallSweep = onStallSuspected
    ? startAgentStallSweep({
        map,
        connectionRegistry,
        onStallSuspected,
        _stallSweepMs: deps._stallSweepMs,
        _stallSuspectMs: deps._stallSuspectMs,
      })
    : undefined

  async function doCreate(agentId: string): Promise<HostResult> {
    // Look up connection
    const conn = connectionRegistry.get(agentId)
    if (!conn) return { ok: false, reason: "not-found" }

    // slice ownership-truth C2: guard — WS owns the wire.
    // slice ownership-handoff C4: when evictionController is available, evict the
    // WS and wait for full detach before proceeding (HTTP takeover).
    // Without evictionController (pre-C4 or tests): still refuse.
    if (connectionRegistry.isOwnedByWs(agentId)) {
      if (!evictionController) {
        log.warn({ agentId }, "agent is owned by WS — refusing to create a session host")
        return { ok: false, reason: "ws-owned" }
      }
      log.info({ agentId }, "agent owned by WS — evicting for HTTP takeover")
      try {
        await evictionController.evictAndWait(agentId, 4409)
      } catch (err) {
        // slice host-result-reason C1: eviction timed out or WS failed to detach —
        // cannot take the wire safely. This is TRANSIENT (a stuck WS tab), not a
        // dead agent — callers map it to 503, not 404.
        log.error({ err, agentId }, "evictAndWait failed — refusing host creation")
        return { ok: false, reason: "evict-timeout" }
      }
    }

    // calev-heavy round 2 finding #5: cwd is validated BEFORE creating the host +
    // broadcaster. The old order created a real ACP host (and a broadcaster that
    // had already started draining host.patches) on the missing-cwd path, then
    // threw — orphaning both with no disposal. Production hosts always start with
    // sessionId:null (createInitialSessionState), so cwd is always required in
    // practice; validating up front is cheap and fail-fast.
    const cwd = connectionRegistry.getCwd(agentId)
    if (!cwd) {
      throw new Error(
        `AgentSessionRegistry: no cwd registered for agentId ${agentId} — cannot auto-create session`,
      )
    }

    // slice ownership-handoff C4: resolve acpSessionId for warm reattach.
    // If the agent has an active ACP session (was WS-owned), use warm path
    // (createAttachedAcpClient + loadSession) instead of cold (createAcpClient + newSession).
    const acpSessionId = getAcpSessionId?.(agentId)
    const permissionPolicy = await getPermissionPolicy?.(agentId)
    const closeOnTurnEndRaw = getCloseOnTurnEnd?.(agentId)
    const closeOnTurnEnd =
      (closeOnTurnEndRaw instanceof Promise
        ? (await closeOnTurnEndRaw) === true
        : closeOnTurnEndRaw === true)

    // Create host + broadcaster
    // slice handoff-foundations C3: if session creation fails below, the host is
    // already subscribed to the wire (created by _createHostFn). Rollback MUST call
    // host.dispose() to remove the crash subscription and close the patches stream.
    // slice agent-charter C2: always wire charter prepend (cold session_open too).
    const hostOpts = {
      transformPromptForAcp: makePromptCharterHook(connectionRegistry, agentId),
      ...buildAgentEventHostOpts({
        agentId, cwd, acpSessionId, permissionPolicy, closeOnTurnEnd,
        onScheduleCloseOnTurnEnd, onTurnEnded,
      }),
    }
    // 🔴 הקשר-אבחון (2026-08-16): יצירת ה-host היא שמריצה את ה-ACP initialize,
    // ולכן כאן נופלות פקיעות ה-initialize/authenticate. עד עכשיו השגיאה עלתה מכאן
    // **בלי שום סימן זיהוי**: נתקלנו בשני כשלים חיים ולא הצלחנו לקבוע בדיעבד
    // איזה CLI נכשל בכלל. שורת-הקשר אחת מייתרת חקירה שלמה.
    let host: Awaited<ReturnType<typeof _createHostFn>>
    try {
      host = await _createHostFn(conn, hostOpts)
    } catch (err) {
      // ⚠️ שדות שטוחים, לא אובייקט-השגיאה. השגיאה של auth נושאת `kind`,
      // `authMethods` וסמל פנימי — והעברתה כ-`err` השתיקה את השורה כולה
      // בשקט (נתפס כאן בבדיקה חיה: אפס שורות מה-ns הזה, בזמן שהשגיאה כן עלתה).
      // ⇒ שורת-אבחון שנבלעת היא גרועה מאין-שורה, כי היא נראית כמו "לא קרה כלום".
      log.error(
        {
          agentId,
          cliKind: connectionRegistry.getCliKind(agentId) ?? "unknown",
          cwd,
          warmReattach: Boolean(acpSessionId),
          reason: err instanceof Error ? err.message : String(err),
        },
        "session-host creation failed (ACP handshake)",
      )
      throw err
    }
    try {
      const broadcaster = _createBroadcasterFn(host.patches)

      // Session init: warm reattach uses loadSession; cold uses newSession.
      // Skip if host already has a sessionId (injected-ready host in tests).
      if (!host.state.sessionId) {
        const mcpServers = optionalAgentMcpServers(agentId, getSelfBaseUrl, host.agentCapabilities) ?? []
        const sessionBase = { cwd, mcpServers }
        if (acpSessionId) {
          await host.loadSession({ ...sessionBase, sessionId: acpSessionId })
        } else {
          await host.newSession(sessionBase)
        }
      }

      // slice remote-warm-reconnect C1: דיווח על ה-session — אחרי ה-if block כולו
      // (בכוונה לא בתוכו): גם host מוזרק-מוכן (נתיב טסטים/המשך) חייב לדווח.
      // sessionId null (newSession לא עדכן state — לא אמור לקרות ב-production) → אין מה לדווח.
      const attachedSessionId = host.state.sessionId
      if (attachedSessionId) {
        try {
          // slice agent-patch-unify C2: cwd כבר בהיקף (נמדד — אתר-קריאה שני,
          // לא רק rpc.ts case "loadSession"). ר' anchor הבא לתיעוד.
          await deps.onSessionAttached?.(agentId, attachedSessionId, cwd)
        } catch (err) {
          log.warn({ err, agentId }, "onSessionAttached failed — host creation continues")
        }
      }

      // slice connection-set C0: host creation does not register a viewer row —
      // rows are born from GET /events or WS attach (D4).
      const entry: HostEntry = { host, broadcaster }
      map.set(agentId, entry)
      return { ok: true, entry }
    } catch (err) {
      // slice handoff-foundations C3: rollback — dispose the orphan host so its
      // crash subscription is removed and patches stream is terminated. Without
      // this, WS could attach to the wire while the orphan host is still listening.
      await host.dispose()
      throw err
    }
  }

  return {
    getHost(agentId: string): ExtendedSessionHost | undefined {
      return map.get(agentId)?.host
    },

    // slice handoff-foundations C3: visible to WS so it can reject during
    // the creation window (between the first await and map.set).
    isHeld(agentId: string): boolean {
      return map.has(agentId) || inFlight.has(agentId)
    },
    async getOrCreateHost(agentId: string): Promise<HostResult> {
      // Return existing entry if already created
      const existing = map.get(agentId)
      if (existing) {
        // slice remote-warm-reconnect C2b: liveness check — connection may have died.
        if (!connectionRegistry.get(agentId)) {
          existing.broadcaster.close()
          map.delete(agentId)
          return { ok: false, reason: "conn-dead" }
        }
        return { ok: true, entry: existing }
      }

      // Return the in-flight creation promise if one is already running — no
      // await happens between this check and inFlight.set below (M5 guard).
      const existingInFlight = inFlight.get(agentId)
      if (existingInFlight) return existingInFlight

      const promise = doCreate(agentId).finally(() => {
        inFlight.delete(agentId)
      })
      inFlight.set(agentId, promise)
      return promise
    },

    getBroadcaster(agentId: string): PatchesBroadcaster | undefined {
      return map.get(agentId)?.broadcaster
    },

    // 🔴 slice sse-liveness Commit 3: MUST stay synchronous (`: void`, no
    // `await`). This is called from ws-agent.ts in a zero-await window between
    // `host.dispose()` and `markAttached` (the epoch bump that signals
    // takeover) — Commit 3ב locks that exact ordering with a real broadcaster.
    // If this became `async`, the caller would need to `await` it, opening an
    // await gap right there and silently breaking `taken-over` (the SSE route
    // would read the OLD epoch before it's bumped). `broadcaster.close()`
    // closes every subscriber controller synchronously — no `await` needed.
    unregisterHost(agentId: string): void {
      connectionRegistry.clearAllConnections(agentId)
      const entry = map.get(agentId)
      entry?.broadcaster.close()
      map.delete(agentId)
    },

    async notifySessionAttached(agentId: string, sessionId: string, cwd?: string): Promise<void> {
      await deps.onSessionAttached?.(agentId, sessionId, cwd)
    },
    getCwd(agentId: string): string | undefined {
      return connectionRegistry.getCwd(agentId)
    },
    getCliKind(agentId: string): string | undefined {
      return connectionRegistry.getCliKind(agentId)
    },
    getEpoch(agentId: string): number {
      return connectionRegistry.getEpoch(agentId)
    },
    touchConnection(agentId: string, connectionId: string): void {
      connectionRegistry.touchConnection(agentId, connectionId)
    },
    getRuntimeInfo(agentId: string) {
      return connectionRegistry.getRuntimeInfo(agentId)
    },
    getConnectionCount(agentId: string) {
      return connectionRegistry.getConnectionCount(agentId)
    },

  /** slice boot-layer C2: stop the HTTP ownership TTL sweep interval. */
  stop(): void {
    clearInterval(httpSweep)
    if (stallSweep) clearInterval(stallSweep)
  },
  }
}
