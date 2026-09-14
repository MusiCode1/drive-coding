/**
 * request-timeout.ts — parsing the permission/elicitation timeout settings.
 *
 * Split out of session-host.ts: this is pure parsing with no dependency on the
 * host, and keeping it here lets a test exercise it without constructing one.
 */

/**
 * Largest delay setTimeout accepts (~24.8 days). Anything above this — and
 * Infinity — is coerced by Node to **1ms** with a TimeoutOverflowWarning.
 */
export const MAX_TIMEOUT_MS = 2_147_483_647

/**
 * resolveRequestTimeoutMs — parses PERMISSION_TIMEOUT_MS / ELICITATION_TIMEOUT_MS.
 *
 * 🔴 Pure + EXPORTED on purpose, for the same reason as resolveHttpOwnerTtlMs
 * in registry.ts: the default path must be executable by a test without an
 * injected seam.
 *
 * The default is `null` — **no timeout**. A permission prompt or a question
 * the user has not answered yet must not answer itself. The previous default
 * (30s → auto-cancel) made the dialog vanish from the UI with no message,
 * and cancelled the tool call that was waiting on it.
 *
 * Accepts a finite, strictly-positive number up to MAX_TIMEOUT_MS. Anything
 * else — missing, blank, "0", "never", "off", NaN, negative, Infinity, or a
 * value past the ceiling — means no timeout.
 *
 * ⚠️ The ceiling is not cosmetic. Passing a larger value through would let
 * Node collapse it to 1ms, cancelling the request almost instantly — the exact
 * opposite of what someone writing a huge number intends. Falling back to
 * "no timeout" fails in the safe direction.
 */
export function resolveRequestTimeoutMs(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === "" || trimmed === "never" || trimmed === "off") return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0 || n > MAX_TIMEOUT_MS) return null
  return n
}

/**
 * The configured defaults for a new session host.
 *
 * Reads the environment here rather than at the call site so that session-host.ts
 * stays free of process.env access.
 */
export function defaultRequestTimeouts(env: NodeJS.ProcessEnv = process.env): {
  permission: number | null
  elicitation: number | null
} {
  return {
    permission: resolveRequestTimeoutMs(env.PERMISSION_TIMEOUT_MS),
    elicitation: resolveRequestTimeoutMs(env.ELICITATION_TIMEOUT_MS),
  }
}
