/**
 * rpc-scope.ts — scoped-write preflight for POST /api/agents/:id/rpc (C2).
 */
// Guard rail, not a lock - see NOT_A_SECURITY_BOUNDARY in ../../agent-scope.ts

import type { AgentRegistry } from "@drive-coding/core"
import { RPC_METHODS } from "@drive-coding/core/session"
import type { Context } from "hono"
import { whenScopedWriteAllowed, SCOPE_DENIED_BODY } from "../../scope-write.js"
import type { AgentSessionRegistry } from "../registry.js"

function preflightRpcScope(
  c: Context,
  agentId: string,
  method: string | undefined,
  agentRegistry: AgentRegistry,
  sessionRegistry: AgentSessionRegistry,
): Promise<Response | null> {
  if (method === undefined || method === RPC_METHODS.listSessions) {
    return Promise.resolve(null)
  }
  return whenScopedWriteAllowed((name) => c.req.header(name), {
    targetId: agentId,
    verb: method,
    registry: agentRegistry,
    sessionRegistry,
  }).then((allowed) => (allowed ? null : c.json(SCOPE_DENIED_BODY, 403)))
}

export function guardRpcRoute(
  c: Context,
  agentId: string,
  method: string | undefined,
  agentRegistry: AgentRegistry,
  sessionRegistry: AgentSessionRegistry,
  run: () => Promise<Response>,
): Promise<Response> {
  return preflightRpcScope(c, agentId, method, agentRegistry, sessionRegistry).then((denied) =>
    denied ? denied : run(),
  )
}
