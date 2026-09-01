import { DC_TOKEN_ENV, SCOPE_HEADER } from "../agent-scope.js"

/** Merge optional scope token from DC_TOKEN into request headers (slice agent-scopes C3). */
export function authedInit(init?: RequestInit): RequestInit {
  const token = process.env[DC_TOKEN_ENV]?.trim()
  if (!token) return init ?? {}
  const headers = new Headers(init?.headers)
  headers.set(SCOPE_HEADER, token)
  return { ...init, headers }
}
