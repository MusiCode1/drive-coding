/**
 * registry.ts — AgentSessionRegistry (S4 C1).
 *
 * Maps agentId → {host: ExtendedSessionHost, broadcaster: PatchesBroadcaster}.
 * Lazy creation: host + broadcaster are created on first getOrCreateHost call.
 *
 * Receives connectionRegistry in constructor — used to look up ProviderConnection
 * by agentId (returns undefined if connection not found → getOrCreateHost returns undefined).
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
 * check and the registration") — an agentId → Promise<HostEntry | undefined> map
 * so concurrent callers share the same in-flight creation.
 */

import type { ProviderConnection } from "@drive-coding/provider/connection"
import { createLogger } from "@drive-coding/core/log"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import { createPatchesBroadcaster, type PatchesBroadcaster } from "./patches-broadcaster.js"
import { createSessionHostFromConnection, type ExtendedSessionHost } from "./session-host.js"

const log = createLogger("backend.session-host.registry")

/**
 * slice remote-warm-reconnect C1: נקרא כש-host מצרף session (יצירה או host מוזרק-מוכן).
 * server.ts מזריק כאן את העדכון לרג'יסטרי הסוכנים (status:"ready" + acpSessionId) —
 * ב-remote mode אף אחד אחר לא כותב acpSessionId (POST /session-attached נקרא רק מנתיבים
 * מקומיים), ובלי זה הסוכן תקוע על status:"starting" וכפתור ה-reconnect disabled.
 */
export type OnSessionAttached = (agentId: string, sessionId: string) => Promise<void> | void

type HostEntry = {
  host: ExtendedSessionHost
  broadcaster: PatchesBroadcaster
}

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
   * - If host already exists → returns {host, broadcaster}
   * - If connection not found in connectionRegistry → returns undefined
   * - Otherwise: creates host + broadcaster, registers them, returns {host, broadcaster}
   */
  getOrCreateHost(agentId: string): Promise<HostEntry | undefined>

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
  notifySessionAttached(agentId: string, sessionId: string): Promise<void>
  /**
   * slice remote-session-mgmt C3: passthrough ל-connectionRegistry.getCwd(agentId).
   * נחוץ ל-loadSession ב-rpc — fallback כש-params.cwd לא נשלח מה-FE.
   */
  getCwd(agentId: string): string | undefined
  /**
   * slice ownership-handoff C3: passthrough to connectionRegistry.getEpoch(agentId).
   * Returns the ownership generation counter (0 for unknown agentId).
   */
  getEpoch(agentId: string): number
}

type AgentSessionRegistryDeps = {
  connectionRegistry: ConnectionRegistry
  /**
   * Injectable for tests — defaults to createSessionHostFromConnection.
   * Receives the ProviderConnection and options, returns Promise<ExtendedSessionHost>.
   * slice ownership-handoff C4: opts includes optional warmReattach for warm path.
   */
  _createHostFn?: (conn: ProviderConnection, opts?: import("../session-host/session-host.js").SessionHostFromConnOptions) => Promise<ExtendedSessionHost>
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
}

export function createAgentSessionRegistry(deps: AgentSessionRegistryDeps): AgentSessionRegistry {
  const {
    connectionRegistry,
    _createHostFn = (conn, opts) => createSessionHostFromConnection(conn, opts),
    _createBroadcasterFn = (patches) => createPatchesBroadcaster(patches),
    evictionController,
    getAcpSessionId,
  } = deps

  const map = new Map<string, HostEntry>()
  // M5: in-flight creation promises — dedups concurrent getOrCreateHost(agentId)
  // callers so only one host + one ACP session get created per agentId.
  const inFlight = new Map<string, Promise<HostEntry | undefined>>()

  async function doCreate(agentId: string): Promise<HostEntry | undefined> {
    // Look up connection
    const conn = connectionRegistry.get(agentId)
    if (!conn) return undefined

    // slice ownership-truth C2: guard — WS owns the wire.
    // slice ownership-handoff C4: when evictionController is available, evict the
    // WS and wait for full detach before proceeding (HTTP takeover).
    // Without evictionController (pre-C4 or tests): still refuse — return undefined.
    if (connectionRegistry.isOwnedByWs(agentId)) {
      if (!evictionController) {
        log.warn({ agentId }, "agent is owned by WS — refusing to create a session host")
        return undefined
      }
      log.info({ agentId }, "agent owned by WS — evicting for HTTP takeover")
      try {
        await evictionController.evictAndWait(agentId, 4409)
      } catch (err) {
        // Eviction timed out or WS failed to detach — cannot take the wire safely
        log.error({ err, agentId }, "evictAndWait failed — refusing host creation")
        return undefined
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

    // Create host + broadcaster
    // slice handoff-foundations C3: if session creation fails below, the host is
    // already subscribed to the wire (created by _createHostFn). Rollback MUST call
    // host.dispose() to remove the crash subscription and close the patches stream.
    const hostOpts = acpSessionId ? { warmReattach: { acpSessionId, cwd } } : undefined
    const host = await _createHostFn(conn, hostOpts)
    try {
      const broadcaster = _createBroadcasterFn(host.patches)

      // Session init: warm reattach uses loadSession; cold uses newSession.
      // Skip if host already has a sessionId (injected-ready host in tests).
      if (!host.state.sessionId) {
        if (acpSessionId) {
          await host.loadSession({ cwd, sessionId: acpSessionId })
        } else {
          await host.newSession({ cwd })
        }
      }

      // slice remote-warm-reconnect C1: דיווח על ה-session — אחרי ה-if block כולו
      // (בכוונה לא בתוכו): גם host מוזרק-מוכן (נתיב טסטים/המשך) חייב לדווח.
      // sessionId null (newSession לא עדכן state — לא אמור לקרות ב-production) → אין מה לדווח.
      const attachedSessionId = host.state.sessionId
      if (attachedSessionId) {
        try {
          await deps.onSessionAttached?.(agentId, attachedSessionId)
        } catch (err) {
          log.warn({ err, agentId }, "onSessionAttached failed — host creation continues")
        }
      }

      // slice ownership-truth C2: ה-host נוצר בהצלחה — סמן בעלות http.
      // זה הופך את attached ל-true, כך שה-FE רואה את הסוכן כתפוס (takeover ring).
      connectionRegistry.markOwned(agentId, "http")

      const entry: HostEntry = { host, broadcaster }
      map.set(agentId, entry)
      return entry
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
    async getOrCreateHost(agentId: string): Promise<HostEntry | undefined> {
      // Return existing entry if already created
      const existing = map.get(agentId)
      if (existing) {
        // slice remote-warm-reconnect C2b: liveness check — ה-connection אולי מת
        // (crash/DELETE) אחרי שה-host נוצר. בלי הניקוי, GET /events היה מחזיר 200
        // עם host מת + snapshot ישן, וה-FE "מתחבר" לסשן מת (פרומפטים נכשלים רק
        // בהמשך). מסירים את ה-entry ומחזירים undefined → 404 → fail-fast ב-VM.
        if (!connectionRegistry.get(agentId)) {
          map.delete(agentId) // = unregisterHost (מכאן אי אפשר לקרוא לו — בתוך ה-object literal)
          return undefined
        }
        return existing
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

    unregisterHost(agentId: string): void {
      // slice ownership-truth C2: שחרר בעלות — אך רק אם הבעלים הוא http.
      // אחרת שחרור host היה מוחק בעלות WS שאינה שלו (WS יכול להיות הבעלים אם
      // הוא השתלט על host קודם — שלב ב', אך השמירה כאן מונעת תקלות עתידיות).
      if (connectionRegistry.getOwner(agentId)?.via === "http") {
        connectionRegistry.markDetached(agentId)
      }
      map.delete(agentId)
    },

    async notifySessionAttached(agentId: string, sessionId: string): Promise<void> {
      await deps.onSessionAttached?.(agentId, sessionId)
    },
    getCwd(agentId: string): string | undefined {
      return connectionRegistry.getCwd(agentId)
    },
    getEpoch(agentId: string): number {
      return connectionRegistry.getEpoch(agentId)
    },
  }
}
