/**
 * turn-lifecycle.ts — turn boundary helpers for SessionHost (slice be-events-subscribe C1).
 */

import type { Patch, SessionState } from "@drive-coding/core/session"
import { isCleanTurnEndForClose } from "./close-on-turn-end.js"
import type { TurnEndedInfo } from "./agent-events-turn.js"

export type TurnTimingHost = {
  getTurnStartedAt(): number
  getStallReported(): boolean
  markStallReported(): void
}

export type TurnLifecycleState = {
  turnSeq: number
  cancelledTurn: number
  closeOnTurnEndScheduled: boolean
  /** slice be-events-subscribe C2: epoch-ms when current turn started */
  turnStartedAt: number
  /** slice be-events-subscribe C2: stall-suspected already emitted this turn */
  stallReported: boolean
}

export function createTurnLifecycleHandlers(deps: {
  getState: () => SessionState
  emit: (r: { state: SessionState; patches: Patch[] }) => void
  closeOnTurnEnd: boolean | undefined
  onScheduleCloseOnTurnEnd: (() => void) | undefined
  onTurnEnded: ((info: TurnEndedInfo) => void) | undefined
  disposed: () => boolean
}): {
  turn: TurnLifecycleState
  emitTurnEnd: (
    r: { state: SessionState; patches: Patch[] },
    info: TurnEndedInfo,
  ) => void
  maybeScheduleCloseOnTurnEnd: () => void
  stampTurnStart: () => void
  resetTurnTiming: () => void
  turnHostMethods: TurnTimingHost
} {
  const turn: TurnLifecycleState = {
    turnSeq: 0,
    cancelledTurn: -1,
    closeOnTurnEndScheduled: false,
    turnStartedAt: 0,
    stallReported: false,
  }

  function stampTurnStart(): void {
    turn.turnStartedAt = Date.now()
    turn.stallReported = false
  }

  function resetTurnTiming(): void {
    turn.turnStartedAt = 0
    turn.stallReported = false
  }

  function emitTurnEnd(
    r: { state: SessionState; patches: Patch[] },
    info: TurnEndedInfo,
  ): void {
    deps.emit(r)
    if (r.patches.length > 0) {
      resetTurnTiming()
      deps.onTurnEnded?.(info)
    }
  }

  function maybeScheduleCloseOnTurnEnd(): void {
    if (!deps.closeOnTurnEnd || turn.closeOnTurnEndScheduled || deps.disposed()) return
    if (!isCleanTurnEndForClose(deps.getState())) return
    turn.closeOnTurnEndScheduled = true
    deps.onScheduleCloseOnTurnEnd?.()
  }

  return {
    turn,
    emitTurnEnd,
    maybeScheduleCloseOnTurnEnd,
    stampTurnStart,
    resetTurnTiming,
    turnHostMethods: {
      getTurnStartedAt: (): number => turn.turnStartedAt,
      getStallReported: (): boolean => turn.stallReported,
      markStallReported: (): void => {
        turn.stallReported = true
      },
    },
  }
}
