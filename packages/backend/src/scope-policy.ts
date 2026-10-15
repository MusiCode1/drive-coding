/**
 * scope-policy.ts — runtime scope policy snapshot + live overrides (C1).
 */
// Guard rail, not a lock - see NOT_A_SECURITY_BOUNDARY in ./agent-scope.ts

import { configDefault } from "@drive-coding/core/config/specs"
import type { Agent } from "@drive-coding/core"
import {
  classifyScopeAction,
  readScopePolicyFromEnv,
  resolveScopePolicy,
  resolveScopePolicySource,
  SCOPE_ACTIONS,
  type AgentScopePolicies,
  type ScopeAction,
  type ScopePolicies,
  type ScopePolicy,
  type ScopePolicySnapshot,
  type ScopePolicySource,
  type ScopePolicyPerAgentPatchPoliciesSchema,
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
  return escalationPolicyForCaller(verb, undefined, env)
}

/** Global + optional per-caller row; unclassified verbs stay ask before any policy read. */
export function mergeAgentScopePolicyPatch(
  current: AgentScopePolicies | undefined,
  patch: typeof ScopePolicyPerAgentPatchPoliciesSchema.infer,
): AgentScopePolicies | undefined {
  const next: AgentScopePolicies = { ...(current ?? {}) }
  for (const action of SCOPE_ACTIONS) {
    const value = patch[action]
    if (value === undefined) continue
    if (value === null) delete next[action]
    else next[action] = value
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export function getEffectiveScopePolicyForAgent(
  caller: Pick<Agent, "scopePolicies"> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ScopePolicySnapshot {
  const globalSnap = getScopePolicySnapshot(env)
  const policies = {} as ScopePolicies
  const sources = {} as Record<ScopeAction, ScopePolicySource>
  for (const action of SCOPE_ACTIONS) {
    const global = globalSnap.policies[action]
    const globalSource = globalSnap.sources[action] as Exclude<ScopePolicySource, "agent">
    const perCaller = caller?.scopePolicies?.[action]
    policies[action] = resolveScopePolicy({ global, perCaller })
    sources[action] = resolveScopePolicySource({ global, globalSource, perCaller })
  }
  return { policies, sources }
}

export function escalationPolicyForCaller(
  verb: string,
  caller: Pick<Agent, "scopePolicies"> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ScopePolicy {
  const action = classifyScopeAction(verb)
  if (action === undefined) return "ask"
  const global = getScopePolicySnapshot(env).policies[action]
  const perCaller = caller?.scopePolicies?.[action]
  return resolveScopePolicy({ global, perCaller })
}
