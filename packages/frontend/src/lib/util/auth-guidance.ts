/**
 * auth-guidance.ts — describeAuthMethod: discriminates an ACP AuthMethod into a
 * rendering-friendly shape for AuthGuidance.svelte.
 *
 * AuthMethod (SDK 1.2.1) is a partially-tagged union:
 *   (AuthMethodEnvVar & {type:"env_var"}) | (AuthMethodTerminal & {type:"terminal"}) | AuthMethodAgent
 * AuthMethodAgent has **no `type` field** — it's the untagged fallback. Narrowing must
 * check `"type" in m` (never `m.type === "agent"` — TS2678, the literal doesn't exist).
 *
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

function nullableToUndefined(v: string | null | undefined): string | undefined {
  return v ?? undefined
}

export function describeAuthMethod(m: AuthMethod): AuthMethodDisplay {
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
