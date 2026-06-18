/**
 * transient-socket-error.ts — classifier for transient socket errors.
 *
 * Used in the global uncaughtException / unhandledRejection handlers (server.ts)
 * to distinguish network-level blips (that should be absorbed) from real bugs
 * (that should still crash the process via process.exit(1)).
 *
 * The function is a pure classifier — no IO, no side effects.
 * Location: backend/delivery (relies on NodeJS.ErrnoException; IO-adjacent).
 */

const TRANSIENT_CODES = new Set(["ECONNRESET", "EPIPE", "ENOTCONN", "ECONNABORTED", "ETIMEDOUT"])

export function isTransientSocketError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === "string" && TRANSIENT_CODES.has(code)
}
