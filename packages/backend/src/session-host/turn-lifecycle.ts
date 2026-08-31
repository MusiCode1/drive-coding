/**
 * turn-lifecycle.ts — turn boundary helpers for SessionHost (slice be-events-subscribe C1).
 */

import type { Patch, SessionState } from "@drive-coding/core"
import { isCleanTurnEndForClose } from "./close-on-turn-end.js"
import type { TurnEndedInfo } from "./agent-events-turn.js"

export type TurnLifecycleState = {
  turnSeq: number
  cancelledTurn: number
  closeOnTurnEndScheduled: boolean
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
  nextTurn: () => number
  markCancelled: (turn: number) => void
  isCancelledTurn: (turn: number) => boolean
} {
  const turn: TurnLifecycleState = { turnSeq: 0, cancelledTurn: -1, closeOnTurnEndScheduled: false }

  function emitTurnEnd(
    r: { state: SessionState; patches: Patch[] },
    info: TurnEndedInfo,
  ): void {
    deps.emit(r)
    if (r.patches.length > 0) {
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
  }
}
