/**
 * session-scope-policy-wiring.svelte.ts — layout effects for per-session scope policy.
 */

import type { AgentSession } from "../view-models/agent-session.svelte"
import { SessionScopePolicy } from "../view-models/session-scope-policy.svelte"
import type { Settings } from "../view-models/settings.svelte"

export function installSessionScopePolicy(deps: {
  session: AgentSession
  settings: Settings
}): SessionScopePolicy {
  const vm = new SessionScopePolicy(
    () => deps.session.agentId,
    () => deps.settings.beUrl,
  )
  $effect(() => {
    deps.settings.beUrl
    vm.noteBeUrlChanged()
  })
  $effect(() => {
    vm.syncAgent(deps.session.agentId)
  })
  return vm
}
