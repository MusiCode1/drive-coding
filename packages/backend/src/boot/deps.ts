/**
 * boot/deps.ts — boot dependencies + pre-serve disposables (C2).
 */

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
import { createAgentEventBus, type AgentEventBus } from "../session-host/agent-events.js"
import { createAndRegisterSessionHostHttp } from "../session-host/http/index.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { createUsageStore, type UsageStore } from "../usage/usage-store.js"
import { createSessionHostRegistryOpts } from "../server-session-host-opts.js"
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
  agentEventBus: AgentEventBus
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
  const agentEventBus = createAgentEventBus()

  const agentSessionRegistry = createAndRegisterSessionHostHttp(app, connectionRegistry, {
    ...createSessionHostRegistryOpts({
      registry,
      projectsRegistry,
      acpSessionIdCache,
      agentEventBus,
      getOrchestrator: () => orchestratorRef.current,
      evictionController,
    }),
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
    agentEventBus,
    orchestrator,
    usageStore,
    memoryGuard,
  }

  return { deps, disposables }
}
