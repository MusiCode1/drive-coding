import type { ChannelResponse } from "@drive-coding/core/session"
import type { HostResult } from "../registry.js"

export function hostFailureResponse(result: Extract<HostResult, { ok: false }>): ChannelResponse {
  // Eviction timeout is transient (a stuck WS tab). The other failures are final.
  const status = result.reason === "evict-timeout" ? 503 : 404
  return { status, body: { error: "Agent connection not found" } }
}

export function hostThrowResponse(err: unknown): ChannelResponse | undefined {
  if (typeof err !== "object" || err === null || !("kind" in err) || err.kind !== "auth_required") {
    return undefined
  }
  const error = "message" in err && typeof err.message === "string" ? err.message : String(err)
  const authMethods = "authMethods" in err ? err.authMethods : []
  return { status: 401, body: { error, kind: err.kind, authMethods } }
}
