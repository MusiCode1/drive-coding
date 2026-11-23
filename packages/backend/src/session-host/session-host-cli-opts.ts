import { getToolOutputRules } from "@drive-coding/provider/config"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import { makePromptCharterHook } from "./session-host-charter.js"

export function makeAgentHostCliOpts(registry: ConnectionRegistry, agentId: string) {
  return {
    transformPromptForAcp: makePromptCharterHook(registry, agentId),
    toolOutputRules: getToolOutputRules(registry.getCliKind(agentId) ?? ""),
  }
}
