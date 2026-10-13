/**
 * scope-policy.ts — runtime scope policy snapshot + live overrides (C1).
 */
// Guard rail, not a lock - see NOT_A_SECURITY_BOUNDARY in ./agent-scope.ts

import { configDefault } from "@drive-coding/core/config/specs"
import {
  classifyScopeAction,
  readScopePolicyFromEnv,
  SCOPE_ACTIONS,
  type ScopeAction,
  type ScopePolicies,
  type ScopePolicy,
  type ScopePolicySnapshot,
  type ScopePolicySource,
} from "@drive-coding/core/schemas/scope-policy"
import { NOT_A_SECURITY_BOUNDARY } from "./agent-scope.js"

void NOT_A_SECURITY_BOUNDARY

const CONFIG_KEY: Record<
  ScopeAction,
  "scopeMessagePolicy" | "scopeUpdatePolicy" | "scopeClosePolicy"
> = {
  message: "scopeMessagePolicy",
  update: "scopeUpdatePolicy",
  close: "scopeClosePolicy",
}

const overrides: Partial<ScopePolicies> = {}

export function resetScopePolicyForTests(): void {
  for (const action of SCOPE_ACTIONS) {
    delete overrides[action]
  }
  delete process.env.SCOPE_MESSAGE_POLICY
  delete process.env.SCOPE_UPDATE_POLICY
  delete process.env.SCOPE_CLOSE_POLICY
}

function resolveOne(
  action: ScopeAction,
  env: NodeJS.ProcessEnv,
): { policy: ScopePolicy; source: ScopePolicySource } {
  const override = overrides[action]
  if (override !== undefined) {
    return { policy: override, source: "override" }
  }
  const fromEnv = readScopePolicyFromEnv(action, env)
  if (fromEnv !== undefined) {
    return { policy: fromEnv, source: "env" }
  }
  return {
    policy: configDefault(CONFIG_KEY[action]),
    source: "default",
  }
}

export function getScopePolicySnapshot(env: NodeJS.ProcessEnv = process.env): ScopePolicySnapshot {
  const policies = {} as ScopePolicies
  const sources = {} as Record<ScopeAction, ScopePolicySource>
  for (const action of SCOPE_ACTIONS) {
    const resolved = resolveOne(action, env)
    policies[action] = resolved.policy
    sources[action] = resolved.source
  }
  return { policies, sources }
}

export function setScopePolicyOverride(patch: Partial<ScopePolicies>): ScopePolicySnapshot {
  for (const action of SCOPE_ACTIONS) {
    const next = patch[action]
    if (next !== undefined) overrides[action] = next
  }
  return getScopePolicySnapshot()
}

/** Policy applied during escalation; unclassified verbs never honor allow. */
export function escalationPolicyForVerb(
  verb: string,
  env: NodeJS.ProcessEnv = process.env,
): ScopePolicy {
  const action = classifyScopeAction(verb)
  if (action === undefined) return "ask"
  return getScopePolicySnapshot(env).policies[action]
}
