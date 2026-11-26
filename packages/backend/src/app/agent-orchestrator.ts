/**
 * Composes agent spawning, connection crash handling, and the close service.
 * Spawn returns "spawning". The frontend marks the agent ready after ACP attaches.
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
import { buildAgentIdentityEnv } from "../agent-identity.js"
import { loopbackBaseUrl, type UrlConfig } from "../delivery/public-url.js"
import { buildOpencodeConfigContent } from "../plugin-config.js"
import { AUDIO_FRIENDLY_PROMPT, buildAgentPromptText } from "../prompts/index.js"
import { type AgentHosts, type CloseTreeResult, createAgentTreeClose } from "./agent-tree-close.js"
import { type CloseAllResult, closeAllAgents } from "./close-all-agents.js"

/** Loopback BASE env every child gets (never PUBLIC_BASE_URL). */
export function buildChildBaseEnv(urlConfig: UrlConfig): Record<string, string> {
  const base = loopbackBaseUrl(urlConfig).replace(/\/$/, "")
  return {
    DRIVE_CODING_BASE: base,
    DC_BASE: base,
  }
}

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
   * End every agent. Returns what happened per id, because a bulk operation
   * that reports only a count hides the one that failed.
   *
   * Independent per agent on purpose: one agent refusing to die must not leave
   * the rest running, which is what a sequential loop with a throw would do.
   */
  deleteAllAndKill(): Promise<CloseAllResult>

  /**
   * Returns 0 for compatibility with callers that expect a bridge port.
   */
  getBridgePort(id: string): number | null

  // נשמר לתאימות לאחור
  _getAgent?: (id: string) => Agent | null
}

type InternalAgentOrchestrator = AgentOrchestrator & {
  closeTree(rootId: string): Promise<CloseTreeResult>
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

/**
 * Composes caller `env` on top of `drivecodingShapeEnv`.
 *
 * **Spawn-only** — not used by in-process bridges (claude/codex). Those receive
 * `agentEnv` on ConnectOpts and inject via `_meta.claudeCode.options.env` (claude)
 * or have no env channel (codex — explicitly exempt from gate 3).
 */
export function composeShapeEnv(
  extraEnv: Record<string, string> | undefined,
): (cliKind: string, baseEnv: NodeJS.ProcessEnv) => NodeJS.ProcessEnv {
  if (!extraEnv || Object.keys(extraEnv).length === 0) {
    return drivecodingShapeEnv
  }
  return (cliKind, baseEnv) => ({
    ...drivecodingShapeEnv(cliKind, baseEnv),
    ...extraEnv,
  })
}

// ─── פקטורי ──────────────────────────────────────────────────────────────────

export function createAgentOrchestrator(deps: {
  registry: AgentRegistry
  connectionRegistry: ConnectionRegistry
  /** Optional host registry for immediate host removal on close or crash. */
  sessionHostRegistry?: AgentHosts
  urlConfig?: UrlConfig
}): InternalAgentOrchestrator {
  const closeService = createAgentTreeClose(deps, log)
  const urlConfig = deps.urlConfig ?? { port: 4000, host: "127.0.0.1" }
  // מאזין התרסקויות: כש-connection מת, סמן סוכן כ-crashed + עדכן registry.
  deps.connectionRegistry.onCrash(async (agentId, info: BridgeCrashInfo) => {
    try {
      // slice remote-warm-reconnect C2b: crash ⇒ ה-host מת ⇒ unregister מיד
      // (GET /events יחזיר 404 במקום 200 עם snapshot ישן).
      deps.sessionHostRegistry?.unregisterHost(agentId)
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
      const identityEnv = buildAgentIdentityEnv(agent.id)
      // Caller env first; identity + loopback BASE always win (public-base-url split).
      const childEnv = {
        ...input.env,
        ...identityEnv,
        ...buildChildBaseEnv(urlConfig),
      }

      try {
        const agentPrompt = buildAgentPromptText(
          {
            agentId: agent.id,
            parentAgentId: agent.parentAgentId,
            charter: agent.systemPrompt ?? undefined,
            userNotes: agent.userNotes,
            sessionFields: agent.sessionFields,
          },
          urlConfig,
        )

        // ── הפעלת connection (connectSpawn דרך connectionRegistry) ──────────────
        // modelOverride (🔴 avigail): מועבר מ-input — לא מקובע null.
        // shapeEnv: spawn-only (opencode config + DRIVE_CODING_AGENT_ID + BASE).
        // agentEnv: same identity/BASE keys for in-process bridges (claude).
        // systemPrompt (slice project-system-prompt): גנרי — הצורה הספציפית-לספק
        // (מיפוי-meta לקלוד / config.developer_instructions לcodex) נכתבת בתוך provider בלבד.
        await deps.connectionRegistry.connect(agent.id, input.cliKind, {
          cwd: input.cwd,
          modelOverride: input.modelOverride ?? null,
          shapeEnv: composeShapeEnv(childEnv),
          agentEnv: childEnv,
          systemPrompt: input.systemPrompt ?? null,
          agentPrompt,
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

    deleteAndKill: closeService.deleteAndKill,
    closeTree: closeService.closeBranch,

    // No await here on purpose: the whole operation lives in closeAllAgents,
    // and keeping this a single delegation keeps the orchestrator a router.
    deleteAllAndKill(): Promise<CloseAllResult> {
      return closeAllAgents(
        () => deps.registry.list(),
        (id) => this.deleteAndKill(id),
      )
    },

    getBridgePort(_id: string): number | null {
      return 0
    },
  }
}
