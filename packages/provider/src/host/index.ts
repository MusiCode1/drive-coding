// claude in-process host factory
export {
  createClaudeInProcessHost,
  type ExtHandlers,
  type InProcessHost,
} from "../providers/claude/in-process-host.js"
export {
  createSpawnCore,
  type SpawnCore,
  type SpawnCoreHandleWithStderr,
  type SpawnCoreHooks,
} from "../shared/spawn-core.js"
// in-process host — provider-agnostic interfaces (no sdk@1.0.0 types)
export type { AdapterHost, NormalizedCapabilities } from "../types.js"
