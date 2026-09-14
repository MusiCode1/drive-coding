/**
 * should-warn-on-leave.ts — pure predicate for leave/beforeunload guards (slice connection-set C3).
 *
 * true only when WS session has active turn and user should see the generic browser warning.
 * HTTP remote viewers skip — the server is the ACP client, not the browser tab.
 */

export type ShouldWarnOnLeaveInput = {
  isRemote: boolean
  bypassActive: boolean
  turnIdle: boolean
  suppress: boolean
}

export function shouldWarnOnLeave(input: ShouldWarnOnLeaveInput): boolean {
  if (input.isRemote) return false
  if (input.bypassActive) return false
  if (input.turnIdle) return false
  if (input.suppress) return false
  return true
}
