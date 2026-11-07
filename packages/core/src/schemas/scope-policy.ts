/**
 * scope-policy.ts — scope action groups + classifier (pure, no IO).
 */

import { type } from "arktype"
import { canonicalRpcMethod, RPC_METHODS } from "../session/rpc-methods.js"

export const ScopePolicy = type("'ask'|'allow'|'deny'")
export type ScopePolicy = typeof ScopePolicy.infer

export const ScopeAction = type("'message'|'update'|'close'")
export type ScopeAction = typeof ScopeAction.infer

export type ScopePolicies = Record<ScopeAction, ScopePolicy>

export type ScopePolicySource = "agent" | "override" | "env" | "default"

export type ScopePolicySnapshot = {
  policies: ScopePolicies
  sources: Record<ScopeAction, ScopePolicySource>
}

export type ScopePolicyPatch = { policies: Partial<ScopePolicies> }

export const SCOPE_ACTIONS: readonly ScopeAction[] = ["message", "update", "close"]

export const SCOPE_POLICY_ENV_KEYS = {
  message: "SCOPE_MESSAGE_POLICY",
  update: "SCOPE_UPDATE_POLICY",
  close: "SCOPE_CLOSE_POLICY",
} as const satisfies Record<ScopeAction, string>

export const ScopePolicySourceSchema = type("'agent'|'override'|'env'|'default'")

/** Partial per-caller overrides stored on Agent.scopePolicies. */
export const AgentScopePoliciesSchema = type({
  "message?": ScopePolicy,
  "update?": ScopePolicy,
  "close?": ScopePolicy,
}).onUndeclaredKey("reject")
export type AgentScopePolicies = typeof AgentScopePoliciesSchema.infer

export const ScopePolicyPerAgentPatchPoliciesSchema = type({
  "message?": ScopePolicy.or("null"),
  "update?": ScopePolicy.or("null"),
  "close?": ScopePolicy.or("null"),
}).onUndeclaredKey("reject")

export const ScopePolicyPerAgentPatchBodySchema = type({
  agent: "string.uuid",
  policies: ScopePolicyPerAgentPatchPoliciesSchema,
}).onUndeclaredKey("reject")

const scopePolicySourcesShape = type({
  message: ScopePolicySourceSchema,
  update: ScopePolicySourceSchema,
  close: ScopePolicySourceSchema,
}).onUndeclaredKey("reject")

export const ScopePoliciesSchema = type({
  message: ScopePolicy,
  update: ScopePolicy,
  close: ScopePolicy,
}).onUndeclaredKey("reject")

export const ScopePolicySnapshotSchema = type({
  policies: ScopePoliciesSchema,
  sources: scopePolicySourcesShape,
}).onUndeclaredKey("reject")

export const ScopePolicyPatchPoliciesSchema = type({
  "message?": ScopePolicy,
  "update?": ScopePolicy,
  "close?": ScopePolicy,
}).onUndeclaredKey("reject")

export const ScopePolicyPatchBodySchema = type({
  policies: ScopePolicyPatchPoliciesSchema,
}).onUndeclaredKey("reject")

/** Raw env read: trim only; exact lowercase enum or undefined (omitted). */
export function parseScopePolicyValue(raw: string | undefined): ScopePolicy | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  const result = ScopePolicy(trimmed)
  if (result instanceof type.errors) return undefined
  return result
}

export function hasScopePolicyPatchKey(
  policies: typeof ScopePolicyPatchPoliciesSchema.infer,
): boolean {
  return policies.message !== undefined || policies.update !== undefined || policies.close !== undefined
}

export function hasScopePolicyPerAgentPatchKey(
  policies: typeof ScopePolicyPerAgentPatchPoliciesSchema.infer,
): boolean {
  return policies.message !== undefined || policies.update !== undefined || policies.close !== undefined
}

/** Pure merge for escalation steps 4–6 (deny wins; per-caller wins over global). */
export function resolveScopePolicy(input: {
  global: ScopePolicy
  perCaller: ScopePolicy | undefined
}): ScopePolicy {
  const { global, perCaller } = input
  if (global === "deny" || perCaller === "deny") return "deny"
  if (perCaller !== undefined) return perCaller
  return global
}

/** Effective source for one action when building GET ?agent= snapshots. */
export function resolveScopePolicySource(input: {
  global: ScopePolicy
  globalSource: Exclude<ScopePolicySource, "agent">
  perCaller: ScopePolicy | undefined
}): ScopePolicySource {
  const { global, globalSource, perCaller } = input
  if (perCaller === "deny") return "agent"
  if (global === "deny") return globalSource
  if (perCaller !== undefined) return "agent"
  return globalSource
}

export function classifyScopeAction(verb: string): ScopeAction | undefined {
  const canonical = canonicalRpcMethod(verb)
  if (canonical !== undefined) {
    if (canonical === RPC_METHODS.listSessions) return undefined
    if (canonical === RPC_METHODS.extMethod) return undefined
    if (canonical === RPC_METHODS.prompt) return "message"
    if (canonical === RPC_METHODS.deleteSession) return "close"
    return "update"
  }
  switch (verb) {
    case "send":
      return "message"
    case "close":
      return "close"
    case "patch":
    case "reply":
      return "update"
    default:
      return undefined
  }
}

export function readScopePolicyFromEnv(
  action: ScopeAction,
  env: NodeJS.ProcessEnv,
): ScopePolicy | undefined {
  return parseScopePolicyValue(env[SCOPE_POLICY_ENV_KEYS[action]])
}
