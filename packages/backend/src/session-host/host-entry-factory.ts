/** Host-entry construction: policy, handshake, initialization and construction rollback. */
import { randomUUID } from "node:crypto"
import { createLogger } from "@drive-coding/core/log"
import type { PermissionPolicyKind } from "@drive-coding/core/types/permission"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import { getSelfBaseUrl } from "../instances.js"
import { buildAgentEventHostOpts } from "./agent-events-registry-opts.js"
import { createPatchesBroadcaster, type PatchesBroadcaster } from "./patches-broadcaster.js"
import { createSessionHostFromConnection, type ExtendedSessionHost } from "./session-host.js"
import { makePromptCharterHook } from "./session-host-charter.js"
import { initSession } from "./session-init.js"

// Preserve the public diagnostic namespace and flat handshake fields.
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

export type HostEntryFactoryDeps = {
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
   * Receives host.patches plus the host identity and returns a PatchesBroadcaster.
   */
  _createBroadcasterFn?: (
    patches: ExtendedSessionHost["patches"],
    hostIncarnation: string,
  ) => PatchesBroadcaster
  /**
   * slice remote-warm-reconnect C1 (אופציונלי): נקרא בתום doCreate, אחרי ש-session
   * צורף (נוצר או הוזרק-מוכן) — ר' OnSessionAttached. כשל בו נבלע (log.warn):
   * הסשן עצמו עובד; תצוגה ישנה בפאנל עדיפה על חיבור שבור.
   */
  onSessionAttached?: OnSessionAttached
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
}

/** The caller validates cwd before invoking this construction boundary. */
export function createHostEntryFactory(deps: HostEntryFactoryDeps) {
  const {
    connectionRegistry,
    _createHostFn: createHost = (conn, opts) => createSessionHostFromConnection(conn, opts),
    _createBroadcasterFn: createBroadcaster = (patches, hostIncarnation) =>
      createPatchesBroadcaster(patches, hostIncarnation),
    getAcpSessionId,
    getPermissionPolicy,
    getCloseOnTurnEnd,
    onScheduleCloseOnTurnEnd,
    onTurnEnded,
  } = deps
  return async function createEntry(
    agentId: string,
    conn: ProviderConnection,
    cwd: string,
  ): Promise<HostEntry> {
    // slice ownership-handoff C4: resolve acpSessionId for warm reattach.
    // If the agent has an active ACP session (was WS-owned), use warm path
    // (createAttachedAcpClient + loadSession) instead of cold (createAcpClient + newSession).
    const acpSessionId = getAcpSessionId?.(agentId)
    const permissionPolicy = await getPermissionPolicy?.(agentId)
    const closeOnTurnEndRaw = getCloseOnTurnEnd?.(agentId)
    const closeOnTurnEnd =
      closeOnTurnEndRaw instanceof Promise
        ? (await closeOnTurnEndRaw) === true
        : closeOnTurnEndRaw === true

    // Create host + broadcaster
    // slice handoff-foundations C3: if session creation fails below, the host is
    // already subscribed to the wire (created by _createHostFn). Rollback MUST call
    // host.dispose() to remove the crash subscription and close the patches stream.
    // slice agent-charter C2: always wire charter prepend (cold session_open too).
    const hostOpts = {
      transformPromptForAcp: makePromptCharterHook(connectionRegistry, agentId),
      ...buildAgentEventHostOpts({
        agentId,
        cwd,
        acpSessionId,
        permissionPolicy,
        closeOnTurnEnd,
        onScheduleCloseOnTurnEnd,
        onTurnEnded,
      }),
    }
    // 🔴 הקשר-אבחון (2026-08-16): יצירת ה-host היא שמריצה את ה-ACP initialize,
    // ולכן כאן נופלות פקיעות ה-initialize/authenticate. עד עכשיו השגיאה עלתה מכאן
    // **בלי שום סימן זיהוי**: נתקלנו בשני כשלים חיים ולא הצלחנו לקבוע בדיעבד
    // איזה CLI נכשל בכלל. שורת-הקשר אחת מייתרת חקירה שלמה.
    const hostIncarnation = randomUUID()
    let host: ExtendedSessionHost
    try {
      host = await createHost(conn, hostOpts)
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
      const broadcaster = createBroadcaster(host.patches, hostIncarnation)

      // Warm when a session id is remembered, cold otherwise — and cold as a
      // fallback if the warm attempt fails, rather than leaving a live agent
      // that nobody can open. See session-init.ts.
      // Skip if host already has a sessionId (injected-ready host in tests).
      if (!host.state.sessionId) {
        await initSession(host, { cwd }, acpSessionId, agentId, {
          cliKind: connectionRegistry.getCliKind(agentId) ?? "unknown",
          caps: host.agentCapabilities,
          getBaseUrl: getSelfBaseUrl,
        })
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
      return { host, broadcaster }
    } catch (err) {
      // Only failures before returning an entry belong to this rollback scope.
      await host.dispose()
      throw err
    }
  }
}
