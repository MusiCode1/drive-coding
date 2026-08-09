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

type ConnEntry = {
  conn: ProviderConnection
  attached: boolean
  rec: WireSession
  unsubs: Array<() => void>
  /**
   * cwd מ-ConnectOpts שנמסר ל-connect() — נשמר כאן כי ConnEntry לא נשא אותו קודם
   * (slice remote-session-view, הכרעה 1: יצירת session אוטומטית ב-BE צריכה cwd
   * בנקודה שבה אין עוד ConnectOpts זמין — session-host/registry.ts).
   */
  cwd: string
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

  markAttached(agentId: string): void
  markDetached(agentId: string): void

  /**
   * getRuntimeInfo — composes conn.turn + conn.pid + attached-state.
   * Returns null if agentId not in registry.
   * pid may be null for in-process connections (e.g. claude in-process, CUT-3b-iii-2).
   */
  getRuntimeInfo(
    agentId: string,
  ): { pid: number | null; attached: boolean; busy: boolean; lastMessageAt: number | null } | null

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
          rec,
          unsubs: [unsubFrame, unsubCrash],
          cwd: connectOpts.cwd,
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

    markAttached(agentId) {
      const e = map.get(agentId)
      if (e) e.attached = true
    },

    markDetached(agentId) {
      const e = map.get(agentId)
      if (e) e.attached = false
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
