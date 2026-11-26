import { createLogger } from "@drive-coding/core/log"
import {
  applyTurnEnd,
  applyTurnStart,
  applyUserMessage,
  type Patch,
  type SessionState,
  synthesizeUserMessage,
} from "@drive-coding/core/session"
import type { AcpClient, PromptBlocks } from "@drive-coding/provider/client"
import { msgOf } from "./error-message.js"
import { SWITCHING_SESSION_ID } from "./session-switch.js"
import type { createTurnLifecycleHandlers } from "./turn-lifecycle.js"

const log = createLogger("backend.session-host.turn")

export type CancelActiveTurnOutcome = "no-active-turn" | "cancel-requested"

export function createSessionHostTurn(deps: {
  client: Pick<AcpClient, "prompt" | "cancel">
  getState: () => SessionState
  isDisposed: () => boolean
  isSwitching: () => boolean
  turnHandlers: Pick<
    ReturnType<typeof createTurnLifecycleHandlers>,
    "turn" | "stampTurnStart" | "emitTurnEnd" | "maybeScheduleCloseOnTurnEnd"
  >
  emit: (result: { state: SessionState; patches: Patch[] }) => void
  transformPromptForAcp?: (content: string | PromptBlocks) => string | PromptBlocks
  startQuotaFetch: (sessionId: string) => void
}) {
  const {
    turn: lifecycle,
    emitTurnEnd,
    maybeScheduleCloseOnTurnEnd,
    stampTurnStart,
  } = deps.turnHandlers
  let requestedCancel: { sessionId: string; turnSeq: number } | undefined

  async function prompt(
    sessionId: string,
    content: string | PromptBlocks,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    if (deps.isDisposed()) throw new Error("SessionHost disposed")
    const turn = ++lifecycle.turnSeq
    stampTurnStart()
    // Publish waiting before the user message. Only the provider receives transformed text.
    deps.emit(applyTurnStart(deps.getState()))
    const state = deps.getState()
    deps.emit(applyUserMessage(state, synthesizeUserMessage(state, content, meta)))
    try {
      const acpContent = deps.transformPromptForAcp?.(content) ?? content
      await deps.client.prompt(sessionId, acpContent)
      if (turn === lifecycle.turnSeq) {
        const finished = deps.getState()
        emitTurnEnd(applyTurnEnd(finished), {
          stopReason: "end_turn",
          contextUsage: finished.contextUsage,
          acpSessionId: finished.sessionId,
        })
        maybeScheduleCloseOnTurnEnd()
        const refreshedSessionId = deps.getState().sessionId
        if (refreshedSessionId) deps.startQuotaFetch(refreshedSessionId)
      }
    } catch (err) {
      if (turn === lifecycle.turnSeq) {
        const failed = deps.getState()
        const error =
          turn === lifecycle.cancelledTurn ? undefined : { message: msgOf(err), at: Date.now() }
        emitTurnEnd(applyTurnEnd(failed, error), {
          stopReason: error?.message,
          lastTurnError: error ?? null,
          contextUsage: failed.contextUsage,
          acpSessionId: failed.sessionId,
        })
      }
      throw err
    }
  }

  async function cancel(sessionId: string): Promise<void> {
    if (deps.isDisposed()) throw new Error("SessionHost disposed")
    const turn = lifecycle.turnSeq
    lifecycle.cancelledTurn = turn
    try {
      await deps.client.cancel(sessionId)
    } catch {
      // Provider cancellation is best-effort.
    }
    if (turn === lifecycle.turnSeq) {
      const state = deps.getState()
      emitTurnEnd(applyTurnEnd(state), {
        stopReason: "cancelled",
        contextUsage: state.contextUsage,
        acpSessionId: state.sessionId,
      })
      maybeScheduleCloseOnTurnEnd()
    }
  }

  function cancelActiveTurn(): CancelActiveTurnOutcome {
    if (deps.isDisposed() || deps.isSwitching()) return "no-active-turn"
    const { sessionId, turnState } = deps.getState()
    if (!sessionId || sessionId === SWITCHING_SESSION_ID || turnState === "idle") {
      return "no-active-turn"
    }
    const turnSeq = lifecycle.turnSeq
    if (requestedCancel?.sessionId !== sessionId || requestedCancel.turnSeq !== turnSeq) {
      // RPC's cancellation marker can refer to a caller-specified session id.
      requestedCancel = { sessionId, turnSeq }
      void cancel(sessionId).catch((err) => {
        log.warn({ err, sessionId, turnSeq }, "cancel active turn failed")
      })
    }
    return "cancel-requested"
  }

  return { prompt, cancel, cancelActiveTurn }
}
