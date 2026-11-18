/**
 * close-on-turn-end.ts — grace timer + clean-turn guard (slice session-lifecycle-fields C1).
 *
 * Even GRACE_MS=0 goes through setTimeout (next tick) so deleteAndKill does not
 * race PatchesBroadcaster's async drain.
 */

import type { SessionState } from "@drive-coding/core/session"

/** Default grace before deleteAndKill after the final turn-end frame is emitted. */
export const DEFAULT_CLOSE_ON_TURN_END_GRACE_MS = 2_000

/**
 * Parses CLOSE_ON_TURN_END_GRACE_MS. Accepts 0 (next tick). Invalid/missing → default.
 */
export function resolveCloseOnTurnEndGraceMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_CLOSE_ON_TURN_END_GRACE_MS
  const trimmed = raw.trim()
  if (trimmed === "") return DEFAULT_CLOSE_ON_TURN_END_GRACE_MS
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CLOSE_ON_TURN_END_GRACE_MS
  return n
}

/**
 * Whether a turn-end may trigger closeOnTurnEnd.
 * Mirrors reduce.ts clean allowlist via lastTurnError + blocks open permission.
 * Error path (applyTurnEnd with error) must NOT call this — agent stays as evidence.
 */
export function isCleanTurnEndForClose(state: SessionState): boolean {
  if (state.pending.permission !== null) return false
  if (state.lastTurnError !== null) return false
  return true
}
