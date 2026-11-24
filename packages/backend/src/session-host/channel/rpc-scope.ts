/**
 * rpc-scope.ts — scoped-write preflight for POST /api/agents/:id/rpc (C2).
 */
// Guard rail, not a lock - see NOT_A_SECURITY_BOUNDARY in ../../agent-scope.ts

import type { AgentRegistry } from "@drive-coding/core"
import { type ChannelResponse, RPC_METHODS } from "@drive-coding/core/session"
import { SCOPE_DENIED_BODY, whenScopedWriteAllowed } from "../../scope-write.js"
import type { AgentSessionRegistry } from "../registry.js"
import type { CallerContext } from "./caller-context.js"

export function preflightRpcScopeDenied(
  caller: CallerContext,
  agentId: string,
  method: string | undefined,
  agentRegistry: AgentRegistry,
  sessionRegistry: AgentSessionRegistry,
): Promise<ChannelResponse | null> {
  if (method === undefined || method === RPC_METHODS.listSessions) {
    return Promise.resolve(null)
  }
  return whenScopedWriteAllowed((name) => caller.header(name), {
    targetId: agentId,
    verb: method,
    registry: agentRegistry,
    sessionRegistry,
  }).then((allowed) => (allowed ? null : { status: 403, body: SCOPE_DENIED_BODY }))
}
