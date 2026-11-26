import {
  applyTurnEnd,
  applyTurnStart,
  applyUserMessage,
  isCleanStopReason,
  type Patch,
  type SessionState,
  synthesizeUserMessage,
} from "@drive-coding/core/session"
import type { AcpClient, PromptBlocks } from "@drive-coding/provider/client"
import type { TurnEndedInfo } from "./agent-events-turn.js"
import { msgOf } from "./error-message.js"
import type { TurnLifecycleState } from "./turn-lifecycle.js"

export type PromptTurnCompletion = {
  stopReason: string
  lastTurnError: SessionState["lastTurnError"]
}

type PromptTurn = {
  seq: number
  sessionId: string
  completion?: PromptTurnCompletion
}

type TurnUpdate = { state: SessionState; patches: Patch[] }

type PromptTurnDeps = {
  client: Pick<AcpClient, "prompt" | "cancel">
  isDisposed: () => boolean
  getState: () => SessionState
  emit: (update: TurnUpdate) => void
  lifecycle: TurnLifecycleState
  stampTurnStart: () => void
  emitTurnEnd: (update: TurnUpdate, info: TurnEndedInfo) => void
  maybeScheduleCloseOnTurnEnd: () => void
  transformPromptForAcp: ((content: string | PromptBlocks) => string | PromptBlocks) | undefined
  startQuotaFetch: (sessionId: string) => void
}

export function createPromptTurn(deps: PromptTurnDeps) {
  let activeTurn: PromptTurn | undefined

  function isCurrent(turn: PromptTurn): boolean {
    return !deps.isDisposed() && turn.seq === deps.lifecycle.turnSeq
  }

  function finish(turn: PromptTurn, completion: PromptTurnCompletion): void {
    if (!isCurrent(turn)) return
    const state = deps.getState()
    const update = applyTurnEnd(state, completion.lastTurnError ?? undefined, completion.stopReason)
    if (turn.completion) {
      // A chunk after local cancellation can reopen the viewer until the
      // original prompt settles. Restore idle without publishing another event.
      deps.emit(update)
      return
    }
    turn.completion = completion
    deps.emitTurnEnd(update, {
      ...completion,
      contextUsage: state.contextUsage,
      acpSessionId: state.sessionId,
    })
    if (completion.lastTurnError === null) deps.maybeScheduleCloseOnTurnEnd()
  }

  return {
    async prompt(
      sessionId: string,
      content: string | PromptBlocks,
      meta?: Record<string, unknown>,
    ): Promise<PromptTurnCompletion> {
      if (deps.isDisposed()) throw new Error("SessionHost disposed")
      const turn: PromptTurn = { seq: ++deps.lifecycle.turnSeq, sessionId }
      activeTurn = turn
      deps.stampTurnStart()
      // Publish waiting before the user message. Only the ACP content gets the charter.
      deps.emit(applyTurnStart(deps.getState()))
      const state = deps.getState()
      deps.emit(applyUserMessage(state, synthesizeUserMessage(state, content, meta)))

      let stopReason: string
      try {
        const acpContent = deps.transformPromptForAcp?.(content) ?? content
        const response = await deps.client.prompt(sessionId, acpContent)
        // Some injected clients predate the PromptResponse return contract.
        stopReason = response === undefined ? "end_turn" : response.stopReason
      } catch (error) {
        const cancelled = turn.seq === deps.lifecycle.cancelledTurn
        const lastTurnError = cancelled ? null : { message: msgOf(error), at: Date.now() }
        finish(
          turn,
          turn.completion ?? { stopReason: lastTurnError?.message ?? "cancelled", lastTurnError },
        )
        throw error
      } finally {
        if (activeTurn === turn) activeTurn = undefined
      }

      const completion = turn.completion ?? {
        stopReason,
        lastTurnError: isCleanStopReason(stopReason)
          ? null
          : { message: stopReason, at: Date.now() },
      }
      finish(turn, completion)
      const currentSessionId = deps.getState().sessionId
      if (isCurrent(turn) && currentSessionId) deps.startQuotaFetch(currentSessionId)
      return completion
    },

    async cancel(sessionId: string): Promise<void> {
      if (deps.isDisposed()) throw new Error("SessionHost disposed")
      const turn = activeTurn
      const target =
        turn?.sessionId === sessionId && isCurrent(turn) && !turn.completion ? turn : undefined
      if (target) deps.lifecycle.cancelledTurn = target.seq
      try {
        await deps.client.cancel(sessionId)
      } catch {
        // Cancellation is best-effort; the local turn may still close.
      }
      if (target && !target.completion) {
        finish(target, { stopReason: "cancelled", lastTurnError: null })
      }
    },
  }
}
