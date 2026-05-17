/**
 * agent-orchestrator.ts — Slim orchestrator for Slice 10.
 *
 * Responsibilities:
 *   1. createAndSpawn: registry.create + bridgeManager.spawn → returns { agentId, wsUrl, bridgePort }
 *      Status stays "spawning" — FE marks "ready" via POST /api/agents/:id/session-attached.
 *   2. deleteAndKill: registry.update(closed) + bridgeManager.kill + registry.delete
 *   3. getBridgePort: used by ws-agent for proxy routing
 *   4. Crash handler: bridgeManager.onCrash → registry.update(status=crashed, crashReason)
 *
 * Removed from Slice 9:
 *   - createAcpWsTransport / createAcpWsLoadTransport (FE does ACP handshake)
 *   - createAgentSession / sessions Map (no server-side ACP session)
 *   - historyBuffer / history broadcast
 *   - projectsRegistry.recordSession (moved to POST /api/agents/:id/session-attached)
 */

import type {
  Agent,
  AgentRegistry,
  BridgeKind,
  BridgeManager,
  CreateAgentInput,
} from "@drive-coding/core"
import { extractProviderError } from "@drive-coding/core/acp/provider-error"
import { createLogger } from "@drive-coding/core/log"
import type { BridgeHandleWithStderr } from "../acp/bridge-manager.js"
import type { ProjectsRegistry } from "./projects-registry.js"

const log = createLogger("backend.orchestrator")

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Backend extension of CreateAgentInput.
 * existingSessionId — if provided, BE dedup checks for an active agent with this session.
 */
export type CreateAndSpawnInput = CreateAgentInput & {
  existingSessionId?: string
}

/**
 * Response shape from createAndSpawn.
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
  /** Create (or deduplicate) an agent + spawn bridge. Returns minimal info; FE does ACP handshake. */
  createAndSpawn(input: CreateAndSpawnInput): Promise<CreateAndSpawnResult>

  /** Delete agent + kill bridge. */
  deleteAndKill(id: string): Promise<void>

  /** Returns the bridge port for a given agent id (for ws-agent routing). */
  getBridgePort(id: string): number | null

  // Kept for backward compat with deleteAndKill (not exposed to FE)
  _getAgent?: (id: string) => Agent | null
}

/** BridgeManager with optional spawnWithStderr extension. */
type ExtendedBridgeManager = BridgeManager & {
  spawnWithStderr?: (
    bridgeId: string,
    input: Parameters<BridgeManager["spawn"]>[1],
  ) => Promise<BridgeHandleWithStderr>
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createAgentOrchestrator(deps: {
  registry: AgentRegistry
  bridgeManager: ExtendedBridgeManager
  projectsRegistry?: ProjectsRegistry
}): AgentOrchestrator {
  // Stores stderr getters keyed by agent id, for crash reason extraction
  const stderrGetters = new Map<string, () => string[]>()

  // In-memory bridge port lookup (agentId → port)
  // Populated on spawn, used by ws-agent for routing without registry async call.
  const bridgePorts = new Map<string, number>()

  // Wire crash handler: when a bridge dies, mark agent as crashed + update registry.
  // The ws-agent pipe will detect bridgeWs.close and send feWs.close(1011, "bridge closed").
  deps.bridgeManager.onCrash(async (bridgeId, exitCode) => {
    try {
      const existing = await deps.registry.get(bridgeId)
      if (existing && existing.status !== "closed") {
        const getStderr = stderrGetters.get(bridgeId)
        const crashReason = getStderr ? (extractProviderError(getStderr()) ?? undefined) : undefined
        await deps.registry.update(bridgeId, { status: "crashed", crashReason })
        log.warn({ bridgeId, exitCode, crashReason }, "bridge crashed")
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

      // ── Dedup check ────────────────────────────────────────────────────────
      // If an active agent already holds this (cwd, acpSessionId), return it
      // without spawning a new bridge.
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

      // ── Create registry entry ──────────────────────────────────────────────
      // Registry uses "starting" (core AgentStatus); response to FE uses "spawning"
      const agent = await deps.registry.create(input)
      await deps.registry.update(agent.id, { status: "starting" })

      try {
        // ── Spawn bridge ───────────────────────────────────────────────────────
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

        // Update registry with bridge port; registry status stays "starting" (FE will update to "ready")
        await deps.registry.update(agent.id, { bridgePort: handle.port })
        bridgePorts.set(agent.id, handle.port)

        const result: CreateAndSpawnResult = {
          agentId: agent.id,
          cwd: agent.cwd,
          cliKind: agent.cliKind as BridgeKind,
          wsUrl: handle.wsUrl,
          bridgePort: handle.port,
          // "spawning" is the FE-facing term; registry uses "starting" (core AgentStatus)
          status: "spawning",
        }

        log.info({ agentId: agent.id, port: handle.port }, "createAndSpawn done — status=spawning")
        return result
      } catch (e) {
        const getStderr = stderrGetters.get(agent.id)
        const crashReason = getStderr ? (extractProviderError(getStderr()) ?? undefined) : undefined
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
        // ignore
      }

      // Kill bridge process
      await deps.bridgeManager.kill(id)

      // Clean up local state
      stderrGetters.delete(id)
      bridgePorts.delete(id)

      try {
        await deps.registry.delete(id)
      } catch {
        // ignore if already gone
      }
    },

    getBridgePort(id: string): number | null {
      return bridgePorts.get(id) ?? null
    },
  }
}
