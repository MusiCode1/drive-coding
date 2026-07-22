/**
 * agent-orchestrator.ts — אורקסטרטור רזה (CUT-3b-ii rewire).
 *
 * תחומי אחריות:
 *   1. createAndSpawn: קורא ל-registry.create + connectionRegistry.connect
 *      → מחזיר { agentId, wsUrl:"", bridgePort:0 } (in-process pipe, אין WS-bridge).
 *      הסטטוס נשאר "spawning" — ה-FE מסמן "ready" דרך POST /api/agents/:id/session-attached.
 *   2. deleteAndKill: registry.update(closed) + connectionRegistry.close + registry.delete
 *   3. getBridgePort: תמיד 0 (in-process — אין WS-bridge אמיתי). נשמר לתאימות.
 *   4. התרסקויות: connectionRegistry.onCrash → registry.update(status=crashed).
 *
 * CUT-3b-ii — שינויים מ-bridge-manager:
 *   - connectSpawn (דרך connectionRegistry.connect) במקום bridgeManager.spawn
 *   - shapeEnv (opencode-only): verbatim מ-bridge-manager:71-83
 *   - modelOverride מועבר (avigail 🔴): ConnectOpts.modelOverride
 *   - bridgePort=0/wsUrl="" קבוע (avigail 🟡): in-process pipe, אין WS-bridge אמיתי
 *   - dead dedup path (if duplicate?.bridgePort) — נשמר כ-no-op (avigail 🟢):
 *     bridgePort תמיד 0, אז if(0) לעולם לא ייכנס — שינוי = שינוי התנהגות
 */

import type {
  Agent,
  AgentRegistry,
  BridgeCrashInfo,
  BridgeKind,
  CreateAgentInput,
} from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { describeCrash } from "@drive-coding/provider/spawn"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import { buildOpencodeConfigContent } from "../plugin-config.js"
import { AUDIO_FRIENDLY_PROMPT } from "../prompts/index.js"
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
 * wsUrl + bridgePort: נשמרים לתאימות shape עם ה-FE.
 * ערכים: wsUrl="" bridgePort=0 — in-process pipe, אין WS-bridge אמיתי.
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
  /** יוצר (או מבצע דה-דופליקציה) לסוכן + מפעיל connection. מחזיר מידע מינימלי; ה-FE מבצע ACP handshake. */
  createAndSpawn(input: CreateAndSpawnInput): Promise<CreateAndSpawnResult>

  /** מוחק סוכן + סוגר את ה-connection. */
  deleteAndKill(id: string): Promise<void>

  /**
   * מחזיר את פורט ה-bridge עבור מזהה סוכן נתון (עבור ניתוב ב-ws-agent).
   * תמיד מחזיר 0 — in-process, אין WS-bridge אמיתי (נשמר לתאימות).
   */
  getBridgePort(id: string): number | null

  // נשמר לתאימות לאחור
  _getAgent?: (id: string) => Agent | null
}

// ─── shapeEnv (verbatim מ-bridge-manager:71-83) ────────────────────────────────
// opencode-only: הזרקת OPENCODE_CONFIG_CONTENT + PROMPT_INJECTOR_TEXT.
// claude: ללא שינוי.
function drivecodingShapeEnv(cliKind: string, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (cliKind === "opencode") {
    return {
      ...baseEnv,
      OPENCODE_CONFIG_CONTENT: buildOpencodeConfigContent(baseEnv.OPENCODE_CONFIG_CONTENT),
      PROMPT_INJECTOR_TEXT: AUDIO_FRIENDLY_PROMPT,
    }
  }
  return baseEnv
}

// ─── פקטורי ──────────────────────────────────────────────────────────────────

export function createAgentOrchestrator(deps: {
  registry: AgentRegistry
  connectionRegistry: ConnectionRegistry
  projectsRegistry?: ProjectsRegistry
}): AgentOrchestrator {
  // מאזין התרסקויות: כש-connection מת, סמן סוכן כ-crashed + עדכן registry.
  deps.connectionRegistry.onCrash(async (agentId, info: BridgeCrashInfo) => {
    try {
      const existing = await deps.registry.get(agentId)
      if (existing && existing.status !== "closed") {
        const crashReason = describeCrash(info, info.stderr ?? [])
        await deps.registry.update(agentId, { status: "crashed", crashReason })
        log.warn(
          { agentId, exitCode: info.exitCode, signal: info.signal, crashReason },
          "bridge crashed",
        )
      }
    } catch (e) {
      log.error({ err: e }, "crash cleanup failed")
    }
  })

  return {
    async createAndSpawn(input: CreateAndSpawnInput): Promise<CreateAndSpawnResult> {
      log.info({ cliKind: input.cliKind, cwd: input.cwd }, "createAndSpawn start")
      const existingSessionId = input.existingSessionId ?? null

      // ── בדיקת כפילויות ────────────────────────────────────────────────────────
      // אם סוכן פעיל כבר מחזיק את ה-(cwd, acpSessionId) הזה, החזר אותו
      // ללא הפעלת connection חדש.
      if (existingSessionId) {
        const allAgents = await deps.registry.list()
        const duplicate = allAgents.find(
          (a) =>
            a.cwd === input.cwd &&
            a.acpSessionId === existingSessionId &&
            (a.status === "ready" || a.status === "busy"),
        )
        // ⚠️ dead dedup (🟢 avigail): bridgePort תמיד 0 → if(0) = false → no-op.
        // נשמר כ-no-op לשמירת behavior (שינוי=רגרסיה).
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
      const agent = await deps.registry.create(input)
      await deps.registry.update(agent.id, { status: "starting" })

      try {
        // ── הפעלת connection (connectSpawn דרך connectionRegistry) ──────────────
        // modelOverride (🔴 avigail): מועבר מ-input — לא מקובע null.
        // shapeEnv (opencode-only): verbatim מ-bridge-manager:71-83.
        // systemPrompt (slice project-system-prompt): גנרי — הצורה הספציפית-לספק
        // (מיפוי-meta לקלוד / config.developer_instructions לcodex) נכתבת בתוך provider בלבד.
        await deps.connectionRegistry.connect(agent.id, input.cliKind, {
          cwd: input.cwd,
          modelOverride: input.modelOverride ?? null,
          shapeEnv: drivecodingShapeEnv,
          systemPrompt: input.systemPrompt ?? null,
        })

        // ⚠️ port/wsUrl stub (🟡 avigail): in-process pipe — אין WS-bridge אמיתי.
        // bridgePort=0, wsUrl="" — נשמרים ב-registry לתאימות shape.
        const bridgePort = 0
        const wsUrl = ""
        await deps.registry.update(agent.id, { bridgePort })

        const result: CreateAndSpawnResult = {
          agentId: agent.id,
          cwd: agent.cwd,
          cliKind: agent.cliKind as BridgeKind,
          wsUrl,
          bridgePort,
          status: "spawning",
        }

        log.info({ agentId: agent.id }, "createAndSpawn done — status=spawning (in-process)")
        return result
      } catch (e) {
        const spawnError =
          e instanceof Error
            ? { code: (e as NodeJS.ErrnoException).code, message: e.message }
            : { message: String(e) }
        const crashReason = describeCrash({ exitCode: null, signal: null, spawnError }, [])

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

      await deps.connectionRegistry.close(id)

      try {
        await deps.registry.delete(id)
      } catch {
        // התעלם if already gone
      }
    },

    getBridgePort(_id: string): number | null {
      // in-process pipe — אין WS-bridge אמיתי; תמיד 0.
      // ws-agent משתמש ב-connectionRegistry.get() לבדיקת presence, לא ב-port.
      return 0
    },
  }
}
