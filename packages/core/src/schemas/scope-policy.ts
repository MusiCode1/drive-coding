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

export type ScopePolicySource = "override" | "env" | "default"

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

export const ScopePoliciesSchema = type({
  message: ScopePolicy,
  update: ScopePolicy,
  close: ScopePolicy,
})

/** Raw env read: trim only; exact lowercase enum or undefined (omitted). */
export function parseScopePolicyValue(raw: string | undefined): ScopePolicy | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  const result = ScopePolicy(trimmed)
  if (result instanceof type.errors) return undefined
  return result
}

/** Config env-layer parse: invalid non-empty explicit value → ask (beats file allow). */
export function parseScopePolicyConfigLayer(raw: string): ScopePolicy | undefined {
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  return parseScopePolicyValue(trimmed) ?? "ask"
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
