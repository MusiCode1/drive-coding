/**
 * agent-orchestrator.ts — אורקסטרטור רזה עבור Slice 10.
 *
 * תחומי אחריות:
 *   1. createAndSpawn: קורא ל-registry.create + bridgeManager.spawn → מחזיר { agentId, wsUrl, bridgePort }
 *      הסטטוס נשאר "spawning" — ה-FE מסמן "ready" דרך POST /api/agents/:id/session-attached.
 *   2. deleteAndKill: קורא ל-registry.update(closed) + bridgeManager.kill + registry.delete
 *   3. getBridgePort: בשימוש של ws-agent עבור ניתוב פרוקסי
 *   4. טיפול בהתרסקויות: bridgeManager.onCrash → מבצע registry.update(status=crashed, crashReason)
 *
 * הוסר מ-Slice 9:
 *   - createAcpWsTransport / createAcpWsLoadTransport (ה-FE מבצע ACP handshake)
 *   - createAgentSession / sessions Map (אין סשן ACP בצד השרת)
 *   - historyBuffer / שידור היסטוריה
 *   - projectsRegistry.recordSession (הועבר אל POST /api/agents/:id/session-attached)
 */

import type {
  Agent,
  AgentRegistry,
  BridgeCrashInfo,
  BridgeKind,
  BridgeManager,
  CreateAgentInput,
} from "@drive-coding/core"
import { describeCrash } from "@drive-coding/provider/spawn"
import { createLogger } from "@drive-coding/core/log"
import type { BridgeHandleWithStderr } from "../acp/bridge-manager.js"
import type { ProjectsRegistry } from "./projects-registry.js"

const log = createLogger("backend.orchestrator")

// ─── סוגים ────────────────────────────────────────────────────────────────────

/**
 * הרחבת צד-שרת של CreateAgentInput.
 * existingSessionId — אם סופק, השרת בודק כפילויות עבור סוכן פעיל עם הסשן הזה.
 */
export type CreateAndSpawnInput = CreateAgentInput & {
  existingSessionId?: string
}

/**
 * מבנה התגובה מ-createAndSpawn.
 */
export type CreateAndSpawnResult = {
  agentId: string
  cwd: string
  cliKind: BridgeKind
  wsUrl: string
  bridgePort: number
  status: "spawning" | "ready"
  acpSessionId?: string
}

export type AgentOrchestrator = {
  /** יוצר (או מבצע דה-דופליקציה) לסוכן + מפעיל bridge. מחזיר מידע מינימלי; ה-FE מבצע ACP handshake. */
  createAndSpawn(input: CreateAndSpawnInput): Promise<CreateAndSpawnResult>

  /** מוחק סוכן + הורג את ה-bridge. */
  deleteAndKill(id: string): Promise<void>

  /** מחזיר את פורט ה-bridge עבור מזהה סוכן נתון (עבור ניתוב ב-ws-agent). */
  getBridgePort(id: string): number | null

  // נשמר לתאימות לאחור עם deleteAndKill (לא נחשף ל-FE)
  _getAgent?: (id: string) => Agent | null
}

/** BridgeManager עם הרחבת spawnWithStderr אופציונלית. */
type ExtendedBridgeManager = BridgeManager & {
  spawnWithStderr?: (
    bridgeId: string,
    input: Parameters<BridgeManager["spawn"]>[1],
  ) => Promise<BridgeHandleWithStderr>
}

// ─── פקטורי ──────────────────────────────────────────────────────────────────

export function createAgentOrchestrator(deps: {
  registry: AgentRegistry
  bridgeManager: ExtendedBridgeManager
  projectsRegistry?: ProjectsRegistry
}): AgentOrchestrator {
  // שומר פונקציות getStderr מקוטלגות לפי מזהה סוכן, לחילוץ סיבת התרסקות
  const stderrGetters = new Map<string, () => string[]>()

  // חיפוש פורט bridge בזיכרון (agentId → port)
  // מאוכלס ב-spawn, בשימוש ws-agent לניתוב ללא קריאה אסינכרונית ל-registry.
  const bridgePorts = new Map<string, number>()

  // מאזין התרסקויות: כש-bridge מת, סמן סוכן כ-crashed + עדכן registry.
  // צינור ה-ws-agent יזהה bridgeWs.close וישלח feWs.close(1011, "bridge closed").
  deps.bridgeManager.onCrash(async (bridgeId, info: BridgeCrashInfo) => {
    try {
      const existing = await deps.registry.get(bridgeId)
      if (existing && existing.status !== "closed") {
        const getStderr = stderrGetters.get(bridgeId)
        const crashReason = describeCrash(info, getStderr ? getStderr() : [])
        await deps.registry.update(bridgeId, { status: "crashed", crashReason })
        log.warn({ bridgeId, exitCode: info.exitCode, signal: info.signal, crashReason }, "bridge crashed")
      }
    } catch (e) {
      log.error({ err: e }, "crash cleanup failed")
    } finally {
      stderrGetters.delete(bridgeId)
      bridgePorts.delete(bridgeId)
    }
  })

  return {
    async createAndSpawn(input: CreateAndSpawnInput): Promise<CreateAndSpawnResult> {
      log.info({ cliKind: input.cliKind, cwd: input.cwd }, "createAndSpawn start")
      const existingSessionId = input.existingSessionId ?? null

      // ── בדיקת כפילויות ────────────────────────────────────────────────────────
      // אם סוכן פעיל כבר מחזיק את ה-(cwd, acpSessionId) הזה, החזר אותו
      // ללא הפעלת bridge חדש.
      if (existingSessionId) {
        const allAgents = await deps.registry.list()
        const duplicate = allAgents.find(
          (a) =>
            a.cwd === input.cwd &&
            a.acpSessionId === existingSessionId &&
            (a.status === "ready" || a.status === "busy"),
        )
        if (duplicate?.bridgePort) {
          log.info({ agentId: duplicate.id, existingSessionId }, "dedup — returning existing agent")
          return {
            agentId: duplicate.id,
            cwd: duplicate.cwd,
            cliKind: duplicate.cliKind as BridgeKind,
            wsUrl: `ws://127.0.0.1:${duplicate.bridgePort}/`,
            bridgePort: duplicate.bridgePort,
            status: "ready",
            acpSessionId: duplicate.acpSessionId ?? undefined,
          }
        }
      }

      // ── יצירת רשומת registry ──────────────────────────────────────────────
      // ה-registry משתמש ב-"starting" (בליבת AgentStatus); התגובה ל-FE משתמשת ב-"spawning"
      const agent = await deps.registry.create(input)
      await deps.registry.update(agent.id, { status: "starting" })

      try {
        // ── הפעלת bridge ───────────────────────────────────────────────────────
        let handle: BridgeHandleWithStderr | Awaited<ReturnType<BridgeManager["spawn"]>>
        if (deps.bridgeManager.spawnWithStderr) {
          handle = await deps.bridgeManager.spawnWithStderr(agent.id, {
            cliKind: input.cliKind,
            cwd: input.cwd,
            modelOverride: input.modelOverride ?? null,
          })
          stderrGetters.set(agent.id, (handle as BridgeHandleWithStderr).getStderr)
        } else {
          handle = await deps.bridgeManager.spawn(agent.id, {
            cliKind: input.cliKind,
            cwd: input.cwd,
            modelOverride: input.modelOverride ?? null,
          })
        }

        // מעדכן את ה-registry עם פורט ה-bridge; הסטטוס נשאר "starting" (ה-FE יעדכן ל-"ready")
        await deps.registry.update(agent.id, { bridgePort: handle.port })
        bridgePorts.set(agent.id, handle.port)

        const result: CreateAndSpawnResult = {
          agentId: agent.id,
          cwd: agent.cwd,
          cliKind: agent.cliKind as BridgeKind,
          wsUrl: handle.wsUrl,
          bridgePort: handle.port,
          // "spawning" הוא המונח מול ה-FE; ה-registry משתמש ב-"starting" (בליבת AgentStatus)
          status: "spawning",
        }

        log.info({ agentId: agent.id, port: handle.port }, "createAndSpawn done — status=spawning")
        return result
      } catch (e) {
        const getStderr = stderrGetters.get(agent.id)
        const spawnError = e instanceof Error
          ? { code: (e as NodeJS.ErrnoException).code, message: e.message }
          : { message: String(e) }
        const crashReason = describeCrash(
          { exitCode: null, signal: null, spawnError },
          getStderr ? getStderr() : [],
        )
        stderrGetters.delete(agent.id)
        bridgePorts.delete(agent.id)

        await deps.registry.update(agent.id, { status: "crashed", crashReason }).catch(() => {})
        throw new Error(
          `spawn failed for agent ${agent.id}: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    },

    async deleteAndKill(id: string): Promise<void> {
      log.info({ agentId: id }, "deleteAndKill")

      try {
        await deps.registry.update(id, { status: "closed" })
      } catch {
        // התעלם
      }

      // הרוג את תהליך ה-bridge
      await deps.bridgeManager.kill(id)

      // נקה מצב מקומי
      stderrGetters.delete(id)
      bridgePorts.delete(id)

      try {
        await deps.registry.delete(id)
      } catch {
        // התעלם if already gone
      }
    },

    getBridgePort(id: string): number | null {
      return bridgePorts.get(id) ?? null
    },
  }
}
