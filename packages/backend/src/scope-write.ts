/**
 * scope-write.ts — shared scoped-write enforcement for HTTP/MCP surfaces (C2).
 */
// Guard rail, not a lock - see NOT_A_SECURITY_BOUNDARY in ./agent-scope.ts

import type { AgentRegistry } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import {
  authorizeWrite,
  NOT_A_SECURITY_BOUNDARY,
  recordAllowAlwaysGrant,
  SCOPE_HEADER,
  verifyToken,
} from "./agent-scope.js"
import type { AgentSessionRegistry } from "./session-host/registry.js"
import type { ScopePermissionHost } from "./session-host/session-host-scope.js"

const log = createLogger("backend.scope")

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
  if (decision !== "allow") {
    log.info(
      { targetId: deps.targetId, verb: deps.verb, stance: NOT_A_SECURITY_BOUNDARY },
      "scoped write denied",
    )
  }
  return decision === "allow"
}

async function escalateScopePermission(deps: ScopedWriteDeps): Promise<"allow" | "deny"> {
  const { token, targetId, verb, sessionRegistry } = deps
  if (!token) return "deny"
  const verified = verifyToken(token)
  if (!verified) return "deny"

  const callerHost = sessionRegistry.getHost(verified.agentId)
  if (!callerHost) return "deny"
  const requestScope = (callerHost as unknown as Partial<ScopePermissionHost>)
    .requestScopePermission
  if (!requestScope) return "deny"
  if (callerHost.state.pending.permission !== null) return "deny"

  const decision = await requestScope({
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

export type ScopeDeniedBody = {
  error: "scope-denied"
  reason: string
  hint: string
}

export function scopeDeniedBody(): ScopeDeniedBody {
  return {
    error: "scope-denied",
    reason: "This write targets an agent outside your subtree and was denied.",
    hint:
      "Ask the user to approve the action in the drive-coding UI. " +
      "If no one responds within 30 seconds, the pending scope request is rejected automatically.",
  }
}

export const SCOPE_DENIED_BODY: ScopeDeniedBody = scopeDeniedBody()

/** MCP session_state only — hides scope escalation pending from agent discovery. */
export function stripScopePendingFromState(out: Record<string, unknown>): Record<string, unknown> {
  const pending = out.pending
  if (!pending || typeof pending !== "object") return out
  const toolCallId = (
    pending as { permission?: { params?: { toolCall?: { toolCallId?: unknown } } } | null }
  ).permission?.params?.toolCall?.toolCallId
  if (typeof toolCallId !== "string" || !toolCallId.startsWith("scope-")) return out
  return { ...out, pending: { ...(pending as Record<string, unknown>), permission: null } }
}

/** Promise-based guard — avoids extra `await` at call sites (size ratchet). */
export function whenScopedWriteAllowed(
  getHeader: (name: string) => string | undefined,
  deps: Omit<ScopedWriteDeps, "token">,
): Promise<boolean> {
  return checkScopedWrite({ token: readScopeToken(getHeader), ...deps })
}
