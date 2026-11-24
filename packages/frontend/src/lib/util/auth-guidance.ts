/**
 * auth-guidance.ts — describeAuthMethod: discriminates an ACP AuthMethod into a
 * rendering-friendly shape for AuthGuidance.svelte.
 *
 * AuthMethod (SDK 1.2.1) is a partially-tagged union:
 *   (AuthMethodEnvVar & {type:"env_var"}) | (AuthMethodTerminal & {type:"terminal"}) | AuthMethodAgent
 * AuthMethodAgent has **no `type` field** — it's the untagged fallback. Narrowing must
 * check `"type" in m` (never `m.type === "agent"` — TS2678, the literal doesn't exist).
 */

import type { AuthMethod } from "@agentclientprotocol/sdk"

export type AuthMethodDisplay =
  | {
      kind: "env_var"
      id: string
      name: string
      description?: string
      varNames: string[]
      link?: string
    }
  | { kind: "terminal"; id: string; name: string; description?: string }
  | { kind: "agent"; id: string; name: string; description?: string }

/**
 * `env_var` left the SDK's AuthMethod type in 1.4.0, but agents built on older SDKs still send it
 * on the wire — so it stays accepted here, typed locally.
 */
type EnvVarAuthMethod = {
  type: "env_var"
  id: string
  name: string
  description?: string | null
  vars: { name: string }[]
  link?: string | null
}

export type GuidanceAuthMethod = AuthMethod | EnvVarAuthMethod

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isOptionalString(value: unknown): boolean {
  return value == null || typeof value === "string"
}

function isGuidanceAuthMethod(value: unknown): value is GuidanceAuthMethod {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !isOptionalString(value.description)
  )
    return false
  if (value.type !== "env_var") return true
  return (
    isOptionalString(value.link) &&
    Array.isArray(value.vars) &&
    value.vars.every((v: unknown) => isRecord(v) && typeof v.name === "string")
  )
}

/** Checks the fields used by the panel, including its keyed list. */
export function readGuidanceAuthMethods(value: unknown): ReadonlyArray<GuidanceAuthMethod> {
  if (!Array.isArray(value) || !value.every(isGuidanceAuthMethod)) return []
  return new Set(value.map((method) => method.id)).size === value.length ? value : []
}

function nullableToUndefined(v: string | null | undefined): string | undefined {
  return v ?? undefined
}

export function describeAuthMethod(m: GuidanceAuthMethod): AuthMethodDisplay {
  if ("type" in m && m.type === "env_var") {
    return {
      kind: "env_var",
      id: m.id,
      name: m.name,
      description: nullableToUndefined(m.description),
      varNames: m.vars.map((v) => v.name),
      link: nullableToUndefined(m.link),
    }
  }
  if ("type" in m && m.type === "terminal") {
    return {
      kind: "terminal",
      id: m.id,
      name: m.name,
      description: nullableToUndefined(m.description),
    }
  }
  // agent — the untagged fallback (no `type` field at all).
  return {
    kind: "agent",
    id: m.id,
    name: m.name,
    description: nullableToUndefined(m.description),
  }
}
