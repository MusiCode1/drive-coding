/**
 * agent-scope.ts — scoped write guard for spawned agents (slice agent-scopes).
 *
 * ⚠️ NOT A SECURITY BOUNDARY — deliberate. Do not "harden" this.
 *
 * This module prevents ACCIDENTS, not attackers. A spawned agent runs as the same
 * OS user as the backend, inherits its full environment (spawn-core.ts builds the
 * child env as `{ ...process.env }`), and can edit this file. All of the following
 * bypass it in one line, BY DESIGN:
 *   - omit the X-Drive-Coding-Scope header -> authorizeWrite() returns "allow"
 *   - read DC_MASTER_KEY / DC_SCOPE_SECRET from its own env -> mint any token
 *   - call the HTTP API directly - the backend has no authentication at all
 *
 * The goal is narrower and worth having: a confused agent pursuing an unrelated
 * task should not close, prompt or reconfigure a STRANGER's session by accident.
 *
 * Reviewing this code? The bypasses above are known and accepted - do not file
 * them as findings. A real boundary needs a separate uid/container per agent, a
 * secret that never enters the child env, and an authenticated FE. That is a
 * project, not a patch. See AGENTS.md, "Agent scopes - a guard rail, not a lock".
 */

import { createHmac, randomBytes } from "node:crypto"

/** Single grep term for the stance above. Referenced from every derived module. */
export const NOT_A_SECURITY_BOUNDARY =
  "accidental-cross-agent-write guard rail; not a security boundary"

export const SCOPE_HEADER = "X-Drive-Coding-Scope"
export const DC_TOKEN_ENV = "DC_TOKEN"
export const DC_MASTER_KEY_ENV = "DC_MASTER_KEY"
export const DC_SCOPE_SECRET_ENV = "DC_SCOPE_SECRET"

const SUBTREE_MAX_DEPTH = 20

let cachedSecret: string | undefined

/** Test hook — clears the in-memory secret cache. */
export function resetScopeSecretForTests(): void {
  cachedSecret = undefined
}

/** Env/config secret; when missing, generated once per process and cached. */
export function getScopeSecret(): string {
  const fromEnv = process.env[DC_SCOPE_SECRET_ENV]?.trim()
  if (fromEnv) return fromEnv
  if (cachedSecret === undefined) {
    cachedSecret = randomBytes(32).toString("base64url")
  }
  return cachedSecret
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("hex")
}

/** Issues a scoped token for agentId using the process secret unless overridden. */
export function issueToken(agentId: string, secret?: string): string {
  const key = secret ?? getScopeSecret()
  const payloadB64 = Buffer.from(JSON.stringify({ v: 1, agentId }), "utf8").toString("base64url")
  return `${payloadB64}.${signPayload(payloadB64, key)}`
}

/** Verifies token integrity and returns the embedded agentId, or undefined. */
export function verifyToken(token: string, secret?: string): { agentId: string } | undefined {
  const key = secret ?? getScopeSecret()
  const dot = token.lastIndexOf(".")
  if (dot <= 0) return undefined
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (signPayload(payloadB64, key) !== sig) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      v?: number
      agentId?: string
    }
    if (parsed.v !== 1 || typeof parsed.agentId !== "string" || parsed.agentId.length === 0) {
      return undefined
    }
    return { agentId: parsed.agentId }
  } catch {
    return undefined
  }
}

/** True when token equals DC_MASTER_KEY (full write access). */
export function isMaster(token: string | undefined, masterKey?: string): boolean {
  if (!token) return false
  const key = masterKey ?? process.env[DC_MASTER_KEY_ENV]?.trim()
  return key !== undefined && key.length > 0 && token === key
}

/** All agent ids in the subtree rooted at rootId (includes root). Cycle-safe, depth-capped. */
export function subtreeIds(
  agents: readonly { id: string; parentAgentId?: string }[],
  rootId: string,
): Set<string> {
  const result = new Set<string>()
  const visited = new Set<string>()

  function walk(id: string, depth: number): void {
    if (depth > SUBTREE_MAX_DEPTH) return
    if (visited.has(id)) return
    visited.add(id)
    result.add(id)
    for (const a of agents) {
      if (a.parentAgentId === id) walk(a.id, depth + 1)
    }
  }

  walk(rootId, 0)
  return result
}

const allowAlwaysGrants = new Set<string>()

function grantKey(callerId: string, targetId: string, verb: string): string {
  return `${callerId}\0${targetId}\0${verb}`
}

/** Records an allow_always grant for subsequent authorizeWrite checks. */
export function recordAllowAlwaysGrant(callerId: string, targetId: string, verb: string): void {
  allowAlwaysGrants.add(grantKey(callerId, targetId, verb))
}

export function hasAllowAlwaysGrant(callerId: string, targetId: string, verb: string): boolean {
  return allowAlwaysGrants.has(grantKey(callerId, targetId, verb))
}

/** Test hook — clears allow_always grants. */
export function resetAllowAlwaysGrantsForTests(): void {
  allowAlwaysGrants.clear()
}

let enforcementEnabled = true

/** Test hook (gate 5): disabling enforcement makes authorizeWrite always allow. */
export function setScopeEnforcementForTests(enabled: boolean): void {
  enforcementEnabled = enabled
}

export type AuthorizeWriteInput = {
  token: string | undefined
  targetId: string
  verb: string
  agents: readonly { id: string; parentAgentId?: string }[]
  onEscalate: () => Promise<"allow" | "deny">
}

/** Single write-authorization point — no token / master / in-subtree / escalate. */
export async function authorizeWrite(input: AuthorizeWriteInput): Promise<"allow" | "deny"> {
  if (!enforcementEnabled) return "allow"
  const { token, targetId, verb, agents, onEscalate } = input
  if (!token) return "allow"
  if (isMaster(token)) return "allow"

  const verified = verifyToken(token)
  if (!verified) return "deny"

  const callerId = verified.agentId
  if (hasAllowAlwaysGrant(callerId, targetId, verb)) return "allow"

  const subtree = subtreeIds(agents, callerId)
  if (subtree.has(targetId)) return "allow"

  return onEscalate()
}
