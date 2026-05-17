import type {
  Agent,
  AgentRegistry,
  BridgeKind,
  BridgeManager,
  CreateAgentInput,
} from "@drive-coding/core"
import { extractProviderError } from "@drive-coding/core/acp/provider-error"
import { createAcpWsLoadTransport, createAcpWsTransport } from "../acp/acp-transport.js"
import type { BridgeHandleWithStderr } from "../acp/bridge-manager.js"
import { type AgentSession, createAgentSession } from "./agent-session.js"
import type { ProjectsRegistry } from "./projects-registry.js"
import type { RecordingsStore } from "./recordings-store.js"

/**
 * Slice 8a: backend-only extension of CreateAgentInput.
 * existingSessionId — if provided, loads an existing ACP session via
 * session/load instead of session/new. Dedup: if an active agent with the
 * same (cwd, acpSessionId) exists, returns it without spawning.
 */
export type CreateAndSpawnInput = CreateAgentInput & {
  /** Optional: load an existing ACP session instead of creating a new one. */
  existingSessionId?: string
}

export type AgentOrchestrator = {
  /** Create an agent (registry) + spawn bridge + ACP attach. On failure: status='crashed'. */
  createAndSpawn(input: CreateAndSpawnInput): Promise<Agent>

  /** Delete agent + kill bridge + shutdown session. */
  deleteAndKill(id: string): Promise<void>

  /** Get live AgentSession for a given agent id. Null if not found or not ready. */
  getSession(id: string): AgentSession | null
}

/** BridgeManager with optional spawnWithStderr extension (added in Slice 5.6). */
type ExtendedBridgeManager = BridgeManager & {
  spawnWithStderr?: (
    bridgeId: string,
    input: Parameters<BridgeManager["spawn"]>[1],
  ) => Promise<BridgeHandleWithStderr>
}

export function createAgentOrchestrator(deps: {
  registry: AgentRegistry
  bridgeManager: ExtendedBridgeManager
  recordingsStore?: RecordingsStore
  /** N4 fix: tracks known cwds for the sessions UI. */
  projectsRegistry?: ProjectsRegistry
}): AgentOrchestrator {
  const sessions = new Map<string, AgentSession>()
  // Stores stderr getters keyed by agent id, for crash extraction
  const stderrGetters = new Map<string, () => string[]>()

  // Wire crash handler: when a bridge dies unexpectedly, mark agent as crashed
  deps.bridgeManager.onCrash(async (bridgeId, exitCode) => {
    try {
      const existing = await deps.registry.get(bridgeId)
      if (existing && existing.status !== "closed") {
        // Try to extract a provider-specific crash reason from stderr
        const getStderr = stderrGetters.get(bridgeId)
        const crashReason = getStderr ? (extractProviderError(getStderr()) ?? undefined) : undefined

        await deps.registry.update(bridgeId, { status: "crashed", crashReason })
        stderrGetters.delete(bridgeId)
      }
      const session = sessions.get(bridgeId)
      if (session) {
        await session.shutdown().catch(() => {})
        sessions.delete(bridgeId)
      }
      console.warn(`[orchestrator] bridge ${bridgeId} crashed with code ${exitCode}`)
    } catch (e) {
      console.error("[orchestrator] crash cleanup failed:", e)
    }
  })

  return {
    async createAndSpawn(input: CreateAndSpawnInput): Promise<Agent> {
      const existingSessionId = input.existingSessionId ?? null

      // ── Dedup check (Slice 8a) ──────────────────────────────────────────────
      // If an active agent already holds this (cwd, acpSessionId), return it
      // directly without spawning a new bridge.
      if (existingSessionId) {
        const allAgents = await deps.registry.list()
        const duplicate = allAgents.find(
          (a) =>
            a.cwd === input.cwd &&
            a.acpSessionId === existingSessionId &&
            (a.status === "ready" || a.status === "busy"),
        )
        if (duplicate) return duplicate
      }

      // 1. Create with status='starting'
      const agent = await deps.registry.create(input)
      await deps.registry.update(agent.id, { status: "starting" })

      try {
        // 2. Spawn bridge — waits for port detection (up to 30s)
        // Prefer spawnWithStderr for stderr access; fall back to plain spawn.
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

        // 3. ACP handshake: session/new OR session/load
        let sessionId: string
        let transport: Awaited<ReturnType<typeof createAcpWsTransport>>

        let historyBuffer: import("@drive-coding/core").SessionNotification[] | undefined
        if (existingSessionId) {
          // Load path: connect to existing session, collect history notifications.
          // Slice 8a (Phase 5): buffer is passed to createAgentSession which
          // broadcasts history_start / history_chunk / history_done on next microtask.
          historyBuffer = []
          transport = await createAcpWsLoadTransport({
            wsUrl: handle.wsUrl,
            cwd: input.cwd,
            sessionId: existingSessionId,
            onHistoryUpdate: (n) => historyBuffer!.push(n),
          })
          const startResult = await transport.start({ cwd: input.cwd })
          sessionId = startResult.sessionId
        } else {
          // New session path (existing behavior)
          historyBuffer = undefined
          transport = await createAcpWsTransport({
            wsUrl: handle.wsUrl,
            cwd: input.cwd,
          })
          const startResult = await transport.start({ cwd: input.cwd })
          sessionId = startResult.sessionId
        }

        // 4. Create AgentSession for fan-out
        // Wire getStderr so provider errors surface after empty responses (PROMPT-17)
        const getStderr = stderrGetters.get(agent.id)
        const agentSession = createAgentSession({
          agentId: agent.id,
          transport,
          ...(getStderr ? { getStderr } : {}),
          ...(deps.recordingsStore ? { recordingsStore: deps.recordingsStore } : {}),
          ...(historyBuffer !== undefined
            ? { historyBuffer, historySessionId: existingSessionId ?? undefined }
            : {}),
        })
        sessions.set(agent.id, agentSession)

        // 5. Mark ready
        const updated = await deps.registry.update(agent.id, {
          status: "ready",
          bridgePort: handle.port,
          acpSessionId: sessionId,
        })

        // N4 fix: record cwd + sessionId so the sessions UI can list them
        if (deps.projectsRegistry) {
          await deps.projectsRegistry.recordCwd(input.cwd, input.cliKind as BridgeKind)
          await deps.projectsRegistry.recordSession(input.cwd, sessionId)
        }

        return updated
      } catch (e) {
        // Try to extract a provider error from stderr before marking crashed
        const getStderr = stderrGetters.get(agent.id)
        const crashReason = getStderr ? (extractProviderError(getStderr()) ?? undefined) : undefined
        stderrGetters.delete(agent.id)

        await deps.registry.update(agent.id, { status: "crashed", crashReason }).catch(() => {})
        throw new Error(
          `spawn/attach failed for agent ${agent.id}: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    },

    async deleteAndKill(id: string): Promise<void> {
      const agent = await deps.registry.get(id)
      if (!agent) return

      // Gracefully mark closed first
      try {
        await deps.registry.update(id, { status: "closed" })
      } catch {
        // ignore
      }

      // Shutdown ACP session
      const session = sessions.get(id)
      if (session) {
        await session.shutdown().catch(() => {})
        sessions.delete(id)
      }

      // Kill bridge process
      await deps.bridgeManager.kill(id)

      // Clean up stderr getter
      stderrGetters.delete(id)

      // Remove from registry
      try {
        await deps.registry.delete(id)
      } catch {
        // ignore if already gone
      }
    },

    getSession(id: string): AgentSession | null {
      return sessions.get(id) ?? null
    },
  }
}
