/** CF Access header carrying the authenticated user email (slice session-attribution-core). */
export const CF_ACCESS_EMAIL_HEADER = "Cf-Access-Authenticated-User-Email"

/** Fail-open: undefined / empty / whitespace-only → undefined; otherwise trimmed. */
export function readOpenedByEmail(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed.length === 0 ? undefined : trimmed
}
