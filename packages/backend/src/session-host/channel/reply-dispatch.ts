import type { ChannelResponse } from "@drive-coding/core/session"
import { verifyToken } from "../../agent-scope.js"
import {
  readScopeToken,
  SCOPE_DENIED_BODY,
  scopeDeniedBody,
  whenScopedWriteAllowed,
} from "../../scope-write.js"
import type { AgentSessionRegistry } from "../registry.js"
import type { CallerContext } from "./caller-context.js"
import type { RpcDispatchDeps } from "./rpc-dispatch.js"

let selfApproveGuardEnabled = true

/** Test hook (G5): disabling makes scope self-approve return 200 like the FE path. */
export function setSelfApproveGuardForTests(enabled: boolean): void {
  selfApproveGuardEnabled = enabled
}

export async function replyScopeDenied(
  deps: RpcDispatchDeps,
  agentId: string,
  caller: CallerContext,
): Promise<ChannelResponse | null> {
  const allowed = await whenScopedWriteAllowed((name) => caller.header(name), {
    targetId: agentId,
    verb: "reply",
    ...deps,
  })
  return allowed ? null : { status: 403, body: SCOPE_DENIED_BODY }
}

export async function dispatchReply(
  sessionRegistry: AgentSessionRegistry,
  agentId: string,
  readBody: () => Promise<unknown>,
  caller: CallerContext,
): Promise<ChannelResponse> {
  const host = sessionRegistry.getHost(agentId)
  if (!host) {
    return { status: 404, body: { error: "Agent connection not found" } }
  }
  const body = (await readBody()) as Record<string, unknown>
  const kind = body.kind
  const requestId = body.requestId as number
  const result = body.result

  if (kind === "permission" && selfApproveGuardEnabled && host.isScopeRequest(requestId)) {
    const token = readScopeToken((name) => caller.header(name))
    if (token && verifyToken(token)) {
      return { status: 403, body: scopeDeniedBody() }
    }
  }

  // Permission and elicitation use separate pending maps despite sharing an ID counter.
  if (kind === "permission") {
    host.respondPermission(requestId, result as Parameters<typeof host.respondPermission>[1])
  } else if (kind === "elicitation") {
    host.respondElicitation(requestId, result as Parameters<typeof host.respondElicitation>[1])
  } else {
    return { status: 400, body: { error: `Unknown kind: ${String(body.kind)}` } }
  }

  return { status: 200, body: { ok: true } }
}
