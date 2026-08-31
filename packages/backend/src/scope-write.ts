/**
 * scope-write.ts — shared scoped-write enforcement for HTTP/MCP surfaces (C2).
 */

import type { AgentRegistry } from "@drive-coding/core"
import {
  authorizeWrite,
  recordAllowAlwaysGrant,
  SCOPE_HEADER,
  verifyToken,
} from "./agent-scope.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"

export { SCOPE_HEADER }

export function readScopeToken(
  getHeader: (name: string) => string | undefined,
): string | undefined {
  const raw = getHeader(SCOPE_HEADER)?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export type ScopedWriteDeps = {
  token: string | undefined
  targetId: string
  verb: string
  registry: AgentRegistry
  sessionRegistry: AgentSessionRegistry
}

/** Returns true when the write may proceed. */
export async function checkScopedWrite(deps: ScopedWriteDeps): Promise<boolean> {
  const agents = await deps.registry.list()
  const decision = await authorizeWrite({
    token: deps.token,
    targetId: deps.targetId,
    verb: deps.verb,
    agents,
    onEscalate: async () => escalateScopePermission(deps),
  })
  return decision === "allow"
}

async function escalateScopePermission(deps: ScopedWriteDeps): Promise<"allow" | "deny"> {
  const { token, targetId, verb, sessionRegistry } = deps
  if (!token) return "deny"
  const verified = verifyToken(token)
  if (!verified) return "deny"

  const callerHost = sessionRegistry.getHost(verified.agentId)
  if (!callerHost?.requestScopePermission) return "deny"
  if (callerHost.state.pending.permission !== null) return "deny"

  const decision = await callerHost.requestScopePermission({
    callerId: verified.agentId,
    targetId,
    verb,
  })
  if (decision === "allow_always") {
    recordAllowAlwaysGrant(verified.agentId, targetId, verb)
    return "allow"
  }
  return decision
}

export const SCOPE_DENIED_BODY = { error: "scope-denied" as const }

/** Promise-based guard — avoids extra `await` at call sites (size ratchet). */
export function whenScopedWriteAllowed(
  getHeader: (name: string) => string | undefined,
  deps: Omit<ScopedWriteDeps, "token">,
): Promise<boolean> {
  return checkScopedWrite({ token: readScopeToken(getHeader), ...deps })
}
