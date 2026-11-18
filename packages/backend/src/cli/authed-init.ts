import { AGENT_ID_HEADER, DRIVE_CODING_AGENT_ID_ENV } from "../agent-identity.js"
import { DC_TOKEN_ENV, SCOPE_HEADER } from "../agent-scope.js"

/** Merge optional scope token and agent id from env into request headers (slice agent-scopes C3). */
export function authedInit(init?: RequestInit): RequestInit {
  const token = process.env[DC_TOKEN_ENV]?.trim()
  const agentId = process.env[DRIVE_CODING_AGENT_ID_ENV]?.trim()
  if (!token && !agentId) return init ?? {}

  const headers = new Headers(init?.headers)
  if (token) headers.set(SCOPE_HEADER, token)
  if (agentId) headers.set(AGENT_ID_HEADER, agentId)
  return { ...init, headers }
}
