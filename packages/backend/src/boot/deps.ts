/**
 * boot/deps.ts — boot dependencies + pre-serve disposables (C2).
 */

import type { DriveCodingConfig } from "@drive-coding/core/config/schema"
import { configDefault } from "@drive-coding/core/config/specs"
import { createLogger } from "@drive-coding/core/log"
import { stopWatching } from "@drive-coding/provider/config"
import type { Hono } from "hono"
import { createConnectionRegistry } from "../acp/connection-registry.js"
import { stopAgentUnit } from "../agents/agent-launcher.js"
import { resolveAgentsStoreFile } from "../agents/agents-store.js"
import {
  createPersistentAgentRegistry,
  type PersistentAgentRegistry,
} from "../agents/persistent-registry.js"
import { shutdownAgents } from "../agents/shutdown-policy.js"
import { type AgentOrchestrator, createAgentOrchestrator } from "../app/agent-orchestrator.js"
import { createRecordingsStore } from "../app/recordings-store.js"
import { createEvictionController } from "../delivery/eviction-controller.js"
import { createMemoryGuard, type MemoryGuard } from "../delivery/memory-guard.js"
import { createWireRecorder } from "../delivery/wire-recorder.js"
import { asTokenUsageStore } from "../history/session-history-as-token-usage.js"
import {
  createSessionHistoryStore,
  resolveHistoryDbFile,
  type SessionHistoryStore,
} from "../history/session-history-store.js"
import { ensureStateSubdir } from "../paths.js"
import { createSessionHostRegistryOpts } from "../server-session-host-opts.js"
import { type AgentEventBus, createAgentEventBus } from "../session-host/agent-events.js"
import { createAndRegisterSessionHostHttp } from "../session-host/http/index.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { wireTokenUsagePatches } from "../usage/token-usage-patch-wire.js"
import type { TokenUsageStore } from "../usage/token-usage-store.js"
import { createUsageStore, type UsageStore } from "../usage/usage-store.js"
import { wireRecorderDir } from "./config.js"

const log = createLogger("backend.server")

/** `ctx` carries the signal that started the shutdown; most disposables ignore it. */
export type ShutdownCtx = { sig: string }
export type Disposable = { name: string; dispose(ctx: ShutdownCtx): void | Promise<void> }

export type BootDeps = {
  env: NodeJS.ProcessEnv
  config: DriveCodingConfig
  registry: PersistentAgentRegistry
  wireRecorder: ReturnType<typeof createWireRecorder>
  connectionRegistry: ReturnType<typeof createConnectionRegistry>
  recordingsStore: ReturnType<typeof createRecordingsStore>
  evictionController: ReturnType<typeof createEvictionController>
  acpSessionIdCache: Map<string, string>
  agentSessionRegistry: AgentSessionRegistry
  agentEventBus: AgentEventBus
  orchestrator: AgentOrchestrator
  usageStore: UsageStore
  tokenUsageStore: TokenUsageStore
  sessionHistoryStore: SessionHistoryStore
  memoryGuard: MemoryGuard
}

export function createDeps(
  config: DriveCodingConfig,
  env: NodeJS.ProcessEnv,
  app: Hono,
): { deps: BootDeps; disposables: Disposable[] } {
  const registry = createPersistentAgentRegistry({
    file: resolveAgentsStoreFile(config, env, configDefault("port")),
  })
  const wireRecorder = createWireRecorder({ dir: wireRecorderDir(config) })
  const connectionRegistry = createConnectionRegistry({ wireRecorder })
  const recordingsStore = createRecordingsStore(ensureStateSubdir("recordings"))
  const evictionController = createEvictionController()
  const acpSessionIdCache = new Map<string, string>()

  const orchestratorRef: { current: AgentOrchestrator | null } = { current: null }
  const tokenUsageStoreRef: { current: TokenUsageStore | null } = { current: null }
  const agentEventBus = createAgentEventBus()

  const historyDbFile = resolveHistoryDbFile(config, env)
  const sessionHistoryStore = createSessionHistoryStore(historyDbFile)
  const tokenUsageStore = asTokenUsageStore(sessionHistoryStore)
  tokenUsageStoreRef.current = tokenUsageStore

  const sessionHostRegistryOpts = createSessionHostRegistryOpts({
    registry,
    acpSessionIdCache,
    sessionHistoryStore,
    agentEventBus,
    getOrchestrator: () => orchestratorRef.current,
    evictionController,
  })
  const eventOnTurnEnded = sessionHostRegistryOpts.onTurnEnded

  const agentSessionRegistry = createAndRegisterSessionHostHttp(app, connectionRegistry, {
    ...sessionHostRegistryOpts,
    _httpOwnerTtlMs: config.httpOwnerTtlMs,
    env,
    onTurnEnded: (agentId, info) => {
      eventOnTurnEnded?.(agentId, info)
      tokenUsageStoreRef.current?.onTurnEnded(agentId, info.acpSessionId ?? null, Date.now())
    },
    afterHostCreated: (agentId, entry) => {
      wireTokenUsagePatches(
        agentId,
        entry.host,
        entry.broadcaster,
        () => tokenUsageStoreRef.current,
        connectionRegistry,
      )
    },
  })

  const orchestrator = createAgentOrchestrator({
    registry,
    connectionRegistry,
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
    // close() is *disconnect* for a sidecar and *kill* for a spawned child, so
    // one call is correct for both; what happens to the survivors is policy.
    {
      name: "connectionRegistry",
      dispose: (ctx) => shutdownAgents(connectionRegistry, ctx, stopAgentUnit),
    },
    { name: "stopWatching", dispose: () => stopWatching() },
    { name: "usageStore", dispose: () => usageStore.flushUsageOnShutdown() },
    { name: "sessionHistoryStore", dispose: () => sessionHistoryStore.close() },
    { name: "agentsStore", dispose: () => registry.flush() },
  ]

  const deps: BootDeps = {
    env,
    config,
    registry,
    wireRecorder,
    connectionRegistry,
    recordingsStore,
    evictionController,
    acpSessionIdCache,
    agentSessionRegistry,
    agentEventBus,
    orchestrator,
    usageStore,
    tokenUsageStore,
    sessionHistoryStore,
    memoryGuard,
  }

  return { deps, disposables }
}
