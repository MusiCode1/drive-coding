/**
 * boot/deps.ts — boot dependencies + pre-serve disposables (C2).
 */

import type { Agent, BridgeKind } from "@drive-coding/core"
import type { DriveCodingConfig } from "@drive-coding/core/config/schema"
import { configDefault } from "@drive-coding/core/config/specs"
import { createLogger } from "@drive-coding/core/log"
import { stopWatching } from "@drive-coding/provider/config"
import type { Hono } from "hono"
import { createConnectionRegistry } from "../acp/connection-registry.js"
import { createInMemoryAgentRegistry } from "../agents/registry.js"
import {
  createAgentOrchestrator,
  type AgentOrchestrator,
} from "../app/agent-orchestrator.js"
import { createProjectsRegistry } from "../app/projects-registry.js"
import { createRecordingsStore } from "../app/recordings-store.js"
import { createEvictionController } from "../delivery/eviction-controller.js"
import { createMemoryGuard, type MemoryGuard } from "../delivery/memory-guard.js"
import { createWireRecorder } from "../delivery/wire-recorder.js"
import { ensureStateSubdir } from "../paths.js"
import { resolveCloseOnTurnEndGraceMs } from "../session-host/close-on-turn-end.js"
import { createAndRegisterSessionHostHttp } from "../session-host/http/index.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { createUsageStore, type UsageStore } from "../usage/usage-store.js"
import { wireRecorderDir } from "./config.js"

const log = createLogger("backend.server")

export type Disposable = { name: string; dispose(): void | Promise<void> }

export type BootDeps = {
  env: NodeJS.ProcessEnv
  config: DriveCodingConfig
  registry: ReturnType<typeof createInMemoryAgentRegistry>
  wireRecorder: ReturnType<typeof createWireRecorder>
  connectionRegistry: ReturnType<typeof createConnectionRegistry>
  projectsRegistry: ReturnType<typeof createProjectsRegistry>
  recordingsStore: ReturnType<typeof createRecordingsStore>
  evictionController: ReturnType<typeof createEvictionController>
  acpSessionIdCache: Map<string, string>
  agentSessionRegistry: AgentSessionRegistry
  orchestrator: AgentOrchestrator
  usageStore: UsageStore
  memoryGuard: MemoryGuard
}

export function createDeps(
  config: DriveCodingConfig,
  env: NodeJS.ProcessEnv,
  app: Hono,
): { deps: BootDeps; disposables: Disposable[] } {
  const registry = createInMemoryAgentRegistry()
  const wireRecorder = createWireRecorder({ dir: wireRecorderDir(config) })
  const connectionRegistry = createConnectionRegistry({ wireRecorder })
  const projectsRegistry = createProjectsRegistry(ensureStateSubdir("cache"))
  const recordingsStore = createRecordingsStore(ensureStateSubdir("recordings"))
  const evictionController = createEvictionController()
  const acpSessionIdCache = new Map<string, string>()

  const orchestratorRef: { current: AgentOrchestrator | null } = { current: null }

  const agentSessionRegistry = createAndRegisterSessionHostHttp(app, connectionRegistry, {
    onSessionAttached: async (agentId, sessionId, cwd) => {
      const agent = await registry.get(agentId)
      if (!agent || agent.status === "closed") {
        log.warn({ agentId, sessionId }, "onSessionAttached: agent missing or closed — skipped")
        return
      }
      const patch: Partial<Pick<Agent, "status" | "acpSessionId" | "cwd">> = {
        status: "ready",
        acpSessionId: sessionId,
      }
      if (cwd !== undefined) patch.cwd = cwd
      await registry.update(agentId, patch)
      acpSessionIdCache.set(agentId, sessionId)
      const effectiveCwd = cwd ?? agent.cwd
      await projectsRegistry.recordCwd(effectiveCwd, agent.cliKind as BridgeKind)
      await projectsRegistry.recordSession(effectiveCwd, sessionId)
    },
    evictionController,
    getAcpSessionId: (agentId) => acpSessionIdCache.get(agentId),
    getPermissionPolicy: async (agentId) => {
      const agent = await registry.get(agentId)
      return agent?.permissionPolicy
    },
    getCloseOnTurnEnd: async (agentId) => {
      const agent = await registry.get(agentId)
      return agent?.closeOnTurnEnd === true
    },
    onScheduleCloseOnTurnEnd: (agentId) => {
      const graceMs = resolveCloseOnTurnEndGraceMs(env.CLOSE_ON_TURN_END_GRACE_MS)
      setTimeout(() => {
        void orchestratorRef.current?.deleteAndKill(agentId).catch((err) => {
          log.warn({ err, agentId }, "closeOnTurnEnd: deleteAndKill failed after grace")
        })
      }, graceMs)
    },
    _httpOwnerTtlMs: config.httpOwnerTtlMs,
    env,
  })

  const orchestrator = createAgentOrchestrator({
    registry,
    connectionRegistry,
    projectsRegistry,
    sessionHostRegistry: agentSessionRegistry,
    urlConfig: config,
  })
  orchestratorRef.current = orchestrator

  const usageStore = createUsageStore(ensureStateSubdir("usage"))
  const memoryGuard = createMemoryGuard({
    thresholdBytes: (config.rssBudgetMb ?? configDefault("rssBudgetMb")) * 1024 * 1024,
  })

  const disposables: Disposable[] = [
    { name: "memoryGuard", dispose: () => memoryGuard.stop() },
    { name: "httpSweep", dispose: () => agentSessionRegistry.stop() },
    {
      name: "connectionRegistry",
      dispose: async () => {
        await Promise.allSettled(connectionRegistry.list().map((id) => connectionRegistry.close(id)))
      },
    },
    { name: "stopWatching", dispose: () => stopWatching() },
    { name: "usageStore", dispose: () => usageStore.flushUsageOnShutdown() },
  ]

  const deps: BootDeps = {
    env,
    config,
    registry,
    wireRecorder,
    connectionRegistry,
    projectsRegistry,
    recordingsStore,
    evictionController,
    acpSessionIdCache,
    agentSessionRegistry,
    orchestrator,
    usageStore,
    memoryGuard,
  }

  return { deps, disposables }
}
