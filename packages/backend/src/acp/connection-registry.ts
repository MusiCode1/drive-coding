/**
 * connection-registry.ts — BE registry of live ProviderConnections (CUT-3b-ii).
 *
 * Replaces createBridgeManager singleton. Manages a Map<agentId, ConnEntry>
 * where each entry holds a ProviderConnection + attached-state (UI concern,
 * BE-side) + WireRecorder session.
 *
 * Design decisions:
 *   - dedup guard (NBug1): connect(agentId) checks Map.has(agentId) BEFORE
 *     connectSpawn — never clobbers a live connection.
 *   - attached-state lives here (not in ws-agent) because getRuntimeInfo needs it
 *     and http-agents reads it (§9#2 from brief).
 *   - wireRecorder session opened in connect, closed in close/onCrash cleanup.
 *   - onFrame registered once per connection in connect (in+out) — not duplicated.
 *   - Routing (CUT-3b-iii-2 + open-cli-registry C3): IN_PROCESS_CONNECTORS map (claude/codex)
 *     → else connectSpawn (opencode/gemini/qoder/any CLI from cli-specs.jsonc).
 *     pid may be null for in-process connections; getRuntimeInfo handles this gracefully.
 */

import type { CliKind } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { loadCliSpecsOverride } from "@drive-coding/provider/config"
import type { ConnectOpts, ProviderConnection } from "@drive-coding/provider/connection"
import {
  connectCodexInProcess,
  connectInProcess,
  connectSpawn,
  decodeWireLine,
} from "@drive-coding/provider/connection"
import type { SpawnBridgeInput } from "@drive-coding/provider/spawn"
// slice liveness C2: ownership transitions invalidate the HTTP response cache
// (otherwise /api/agents would keep serving attached:true after an eviction).
import { httpCacheInvalidateAll } from "../delivery/http-cache.js"
import type { WireRecorder, WireSession } from "../delivery/wire-recorder.js"

const wireLog = createLogger("backend.acp.wire")
const cfgLog = createLogger("backend.acp.config")

// satisfies שומר על שני הליטרלים: טעות-כתיב כאן משנה ניתוב, וחייבת להיתפס בקומפילציה.
const IN_PROCESS_CONNECTORS = {
  claude: connectInProcess,
  codex: connectCodexInProcess,
} satisfies Partial<Record<CliKind, (opts: ConnectOpts) => Promise<ProviderConnection>>>

/** override מכוון ל-CLI in-process ידרוס bin/args בשקט — הם לא נקראים כלל שם. */
function overrideHasBinOrArgs(kind: string): boolean {
  const o = loadCliSpecsOverride()[kind]
  return o?.bin !== undefined || o?.args !== undefined
}

/**
 * slice ownership-truth C1: ownership record.
 * `via` identifies which transport holds the pipe — "ws" or "http".
 * `since` is epoch-ms of the last ownership transition (for observability).
 * A single ownership slot (not two booleans) enforces transport exclusivity
 * structurally — it is impossible to represent ws=true AND http=true.
 */
export type Owner = {
  via: "ws" | "http"
  since: number
}
type ConnEntry = {
  conn: ProviderConnection
  attached: boolean
  /**
   * slice ownership-truth C1: who owns the pipe, and in which generation.
   * Invariant: attached === (owner !== null) — kept consistent by
   * markOwned/markDetached. owner is null when no transport holds the pipe.
   */
  owner: Owner | null
  /**
   * slice ownership-truth C1: ownership generation counter.
   * Rises by 1 on every null→owner AND owner→owner transition.
   * Never decreases. **Survives markDetached** (owner→null does NOT reset it)
   * because it lives on ConnEntry, not inside Owner — so the last generation
   * is always available for diagnostics even after release.
   */
  ownershipEpoch: number
  rec: WireSession
  unsubs: Array<() => void>
  /**
   * cwd מ-ConnectOpts שנמסר ל-connect() — נשמר כאן כי ConnEntry לא נשא אותו קודם
   * (slice remote-session-view, הכרעה 1: יצירת session אוטומטית ב-BE צריכה cwd
   * בנקודה שבה אין עוד ConnectOpts זמין — session-host/registry.ts).
   */
  cwd: string
  /**
   * slice ownership-handoff C4b + slice liveness C1: last time the owner sent a
   * liveness signal (WS $/ping or HTTP presence).
   * Separate from Owner.since (ownership transition time).
   * Updated by touchOwner(); null when there is no owner. Transport-agnostic —
   * the unified sweep in session-host/registry.ts decides transport on its own
   * (via the explicit `via` check), never from lastSeenAt's null-ness.
   */
  lastSeenAt: number | null
}

export type ConnectionRegistry = {
  /**
   * connect — spawn + register. Dedup: if agentId already in Map, throws.
   * This is the NBug1 guard (moved from bridge-manager.spawnInternal).
   */
  connect(
    agentId: string,
    cliKind: SpawnBridgeInput["cliKind"],
    opts: ConnectOpts,
  ): Promise<ProviderConnection>

  get(agentId: string): ProviderConnection | undefined

  /**
   * getCwd — cwd שנמסר ל-connect() עבור agentId זה, או undefined אם לא רשום.
   * נדרש ל-session-host/registry.ts (יצירת session אוטומטית — slice remote-session-view).
   */
  getCwd(agentId: string): string | undefined

  /** list — כל ה-agentIds החיים (לכיבוי-מסודר). */
  list(): string[]

  /**
   * slice ownership-truth C1: mark the pipe as owned by a transport.
   * Sets owner, increments ownershipEpoch (both null→owner and owner→owner),
   * and synchronizes attached=true. Keeping `via` in a single ownership slot
   * enforces transport exclusivity structurally.
   */
  markOwned(agentId: string, via: "ws" | "http"): void

  /**
   * slice ownership-truth C1: release ownership. Clears owner (→null) and
   * synchronizes attached=false. ownershipEpoch is NOT reset — it survives
   * release (lives on ConnEntry, not inside Owner).
   */
  markDetached(agentId: string): void

  /**
   * slice ownership-truth C1: alias for markOwned(agentId, "ws").
   * Kept for backward compatibility — ws-agent.ts and tests call this.
   */
  markAttached(agentId: string): void

  /**
   * isAttached — האם יש לקוח חי על agentId (מכל טרנספורט, לא רק WS).
   * slice remote-warm-reconnect C2: ה-session-host registry מסרב ליצור host לסוכן
   * attached — שני לקוחות ACP על אותו wire = השחתת סשן.
   * slice ownership-truth C2: ל-guard הספציפי-ל-WS ראה isOwnedByWs.
   */
  isAttached(agentId: string): boolean

  /**
   * slice ownership-truth C1: returns the current owner, or null if released.
   */
  getOwner(agentId: string): Owner | null

  /**
   * slice ownership-truth C1: returns the ownership generation counter.
   * Starts at 0, rises by 1 on each ownership transition, never decreases.
   * Returns 0 for unknown agentId.
   */
  getEpoch(agentId: string): number

  /**
   * slice ownership-truth C2: האם הבעלים הנוכחי הוא WS ספציפית.
   * ה-guard ב-session-host/registry שואל "האם WS מחזיק את הצינור" —
   * isAttached כבר לא עונה על זה כי attached מציין בעלות מכל טרנספורט.
   */
  isOwnedByWs(agentId: string): boolean
  /**
   * getRuntimeInfo — composes conn.turn + conn.pid + attached-state + ownership via.
   * Returns null if agentId not in registry.
   * pid may be null for in-process connections (e.g. claude in-process, CUT-3b-iii-2).
   * slice ownership-truth C3: now also returns `via` from the owner record.
   * slice liveness C4: now also returns `lastSeenAt` (the liveness stamp) so the
   * FE can derive the "connected" dimension — `attached` alone is fakeable.
   */
  getRuntimeInfo(
    agentId: string,
  ): {
    pid: number | null
    attached: boolean
    busy: boolean
    lastMessageAt: number | null
    lastSeenAt: number | null
    via: "ws" | "http" | null
  } | null

  /**
   * slice liveness C1: update lastSeenAt for any owned agent (ws or http).
   * No-op if agentId not found or no owner.
   */
  touchOwner(agentId: string): void

  /**
   * slice liveness C1: returns the lastSeenAt for any owned agent (ws or http),
   * or null if not found / no owner.
   */
  getLastSeenAt(agentId: string): number | null

  /**
   * close — kill child + remove from Map + close wireRecorder session.
   */
  close(agentId: string): Promise<void>

  /**
   * onCrash — subscribe to crashes from ANY registered connection.
   * Aggregate: per-conn onCrash → calls cb(agentId, info).
   * Returns unsubscribe.
   */
  onCrash(
    cb: (agentId: string, info: import("@drive-coding/provider/spawn").BridgeCrashInfo) => void,
  ): () => void
}

export function createConnectionRegistry(opts?: {
  wireRecorder?: WireRecorder
}): ConnectionRegistry {
  const wireRecorder = opts?.wireRecorder
  const map = new Map<string, ConnEntry>()
  const crashListeners = new Set<
    (agentId: string, info: import("@drive-coding/provider/spawn").BridgeCrashInfo) => void
  >()
  // #7 — טוקן-ביטול פר-spawn-בטיסה: סוגר את חלון-הרייס שבו DELETE מגיע בזמן
  // ש-connect עדיין ב-await (map.set טרם רץ) → child אלמותי-בלתי-נגיש.
  const pending = new Map<string, { cancelled: boolean }>()

  function cleanup(agentId: string): void {
    const entry = map.get(agentId)
    if (!entry) return
    for (const unsub of entry.unsubs) {
      try {
        unsub()
      } catch {
        /* ignore */
      }
    }
    entry.rec.close()
    map.delete(agentId)
  }

  return {
    async connect(agentId, cliKind, connectOpts) {
      // ── NBug1 dedup guard (🔴 avigail): check BEFORE connectSpawn ──
      if (map.has(agentId)) {
        throw new Error(`connection-registry: agentId already live: ${agentId}`)
      }
      // ── #7 double-connect guard: אותו agentId כבר בטיסה (in-flight spawn) ──
      if (pending.has(agentId)) {
        throw new Error(`connection-registry: agentId already connecting: ${agentId}`)
      }
      const token = { cancelled: false }
      pending.set(agentId, token)

      try {
        const rec = wireRecorder?.open(agentId) ?? { record() {}, close() {} }

        // ── Routing (CUT-3b-iii-2 + codex-inprocess + open-cli-registry): ──
        // in-process (claude/codex) → IN_PROCESS_CONNECTORS map
        // else                      → connectSpawn (opencode/gemini/qoder/כל CLI מהקונפ')
        if (cliKind in IN_PROCESS_CONNECTORS && overrideHasBinOrArgs(cliKind)) {
          // override.bin/args are silently ignored here — in-process connectors don't call getCliCommand.
          cfgLog.warn({ cliKind }, "cli-specs override.bin/args ignored for in-process cliKind")
        }
        const inProcess = IN_PROCESS_CONNECTORS[cliKind as keyof typeof IN_PROCESS_CONNECTORS]
        const conn = inProcess
          ? await inProcess(connectOpts)
          : await connectSpawn(cliKind, connectOpts)

        // #7 — DELETE הגיע בזמן ה-spawn? סגור מיָד ואל תרשום (מונע child אלמותי).
        // אין await בין הבדיקה הזו ל-map.set למטה — זה מה שסוגר את חלון-הרייס.
        if (token.cancelled) {
          rec.close()
          await conn.close().catch(() => {
            /* child may already be dead */
          })
          throw new Error(`connection-registry: connect cancelled by concurrent close: ${agentId}`)
        }

        // Register onFrame once (in+out) for wire-observability.
        // Must NOT decode in wire.write separately — this is the single decode point.
        const unsubFrame = conn.onFrame((frame) => {
          try {
            const s = decodeWireLine(frame.raw)
            const type =
              s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")
            wireLog.debug({ agentId, dir: frame.dir, type, id: s.id }, "wire")
            if (!s.unparsed)
              wireLog.trace({ agentId, dir: frame.dir, frame: s.parsed }, "wire-full")
          } catch {
            /* silent — must not break the pipe */
          }
          rec.record(frame.dir, frame.raw)
        })

        // onCrash: notify aggregate listeners + cleanup entry.
        const unsubCrash = conn.onCrash((info) => {
          for (const cb of crashListeners) {
            try {
              cb(agentId, info)
            } catch {
              /* ignore */
            }
          }
          cleanup(agentId)
        })
        map.set(agentId, {
          conn,
          attached: false,
          owner: null,
          ownershipEpoch: 0,
          rec,
          unsubs: [unsubFrame, unsubCrash],
          cwd: connectOpts.cwd,
          lastSeenAt: null,
        })
        return conn
      } finally {
        pending.delete(agentId)
      }
    },

    get(agentId) {
      return map.get(agentId)?.conn
    },

    getCwd(agentId) {
      return map.get(agentId)?.cwd
    },

    list() {
      return [...map.keys()]
    },
    markOwned(agentId, via) {
      const e = map.get(agentId)
      if (!e) return
      e.owner = { via, since: Date.now() }
      e.ownershipEpoch++
      e.attached = true
      // slice liveness C1: initialize lastSeenAt on any ownership acquisition —
      // transport-agnostic (the unified sweep decides transport via `via`, §2.1).
      e.lastSeenAt = Date.now()
      // slice liveness C2: ownership changed → cached attached/via answers are stale.
      httpCacheInvalidateAll()
    },

    markAttached(agentId) {
      // alias for markOwned(agentId, "ws") — backward compat (ws-agent.ts, tests)
      const e = map.get(agentId)
      if (!e) return
      e.owner = { via: "ws", since: Date.now() }
      e.ownershipEpoch++
      e.attached = true
      // slice liveness C1: WS also gets a lastSeenAt stamp (fed by $/ping → touchOwner).
      e.lastSeenAt = Date.now()
      // slice liveness C2: ownership changed → cached attached/via answers are stale.
      httpCacheInvalidateAll()
    },

    markDetached(agentId) {
      const e = map.get(agentId)
      if (!e) return
      e.owner = null
      e.attached = false
      // ownershipEpoch deliberately NOT decremented — it survives release (C1 §3)
      // slice liveness C2: ownership changed → cached attached/via answers are stale.
      httpCacheInvalidateAll()
    },

    isAttached(agentId) {
      return map.get(agentId)?.attached ?? false
    },

    getOwner(agentId) {
      return map.get(agentId)?.owner ?? null
    },

    getEpoch(agentId) {
      return map.get(agentId)?.ownershipEpoch ?? 0
    },

    touchOwner(agentId) {
      const e = map.get(agentId)
      if (!e?.owner) return
      e.lastSeenAt = Date.now()
    },

    getLastSeenAt(agentId) {
      const e = map.get(agentId)
      if (!e?.owner) return null
      return e.lastSeenAt
    },

    isOwnedByWs(agentId) {
      return map.get(agentId)?.owner?.via === "ws"
    },

    getRuntimeInfo(agentId) {
      const e = map.get(agentId)
      if (!e) return null
      // pid may be null for in-process connections (claude in-process, CUT-3b-iii-2).
      // We must NOT short-circuit on null — attached/busy/lastMessageAt are still valid.
      return {
        pid: e.conn.pid,
        attached: e.attached,
        busy: e.conn.turn.isBusy(),
        lastMessageAt: e.conn.turn.lastActivityAt(),
        lastSeenAt: e.lastSeenAt,
        via: e.owner?.via ?? null,
      }
    },

    async close(agentId) {
      // #7 — סמן ל-connect שבטיסה (אם יש) לבטל את עצמו ברגע שה-spawn מסתיים.
      const pend = pending.get(agentId)
      if (pend) pend.cancelled = true
      const e = map.get(agentId)
      if (!e) return // אם רק pending — הסימון לבד מספיק; connect יסגור בעצמו
      cleanup(agentId)
      try {
        await e.conn.close()
      } catch {
        /* child may already be dead */
      }
    },

    onCrash(cb) {
      crashListeners.add(cb)
      return () => {
        crashListeners.delete(cb)
      }
    },
  }
}
