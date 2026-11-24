import { PipeError } from "$lib/session/wire/pipe"
import { type GuidanceAuthMethod, readGuidanceAuthMethods } from "$lib/util/auth-guidance"
import { formatAcpError } from "./format-acp-error"

export function sessionAttachFailure(cause: unknown): {
  error: string
  authMethods: ReadonlyArray<GuidanceAuthMethod>
} {
  const fallback = formatAcpError(cause)
  const body = cause instanceof PipeError && cause.status === 401 ? cause.body : undefined
  if (body && typeof body === "object" && "kind" in body && body.kind === "auth_required") {
    return {
      error:
        "error" in body && typeof body.error === "string" && body.error ? body.error : fallback,
      authMethods: readGuidanceAuthMethods("authMethods" in body ? body.authMethods : undefined),
    }
  }
  return { error: fallback, authMethods: [] }
}
