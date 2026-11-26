import { createLogger } from "@drive-coding/core/log"
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
import { SWITCHING_SESSION_ID } from "./session-switch.js"
import type { TurnLifecycleState } from "./turn-lifecycle.js"

const log = createLogger("backend.session-host.turn")

export type CancelActiveTurnOutcome = "no-active-turn" | "cancel-requested"

export type PromptTurnCompletion = {
  stopReason: string
  lastTurnError: SessionState["lastTurnError"]
}

type TurnIdentity = { seq: number; sessionId: string }

type PromptTurn = TurnIdentity & {
  completion?: PromptTurnCompletion
}

type TurnUpdate = { state: SessionState; patches: Patch[] }

type PromptTurnDeps = {
  client: Pick<AcpClient, "prompt" | "cancel">
  isDisposed: () => boolean
  isSwitching: () => boolean
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
  let publishedTurn:
    | { seq: number; sessionId: SessionState["sessionId"]; completion: PromptTurnCompletion }
    | undefined
  let requestedCancel: TurnIdentity | undefined

  function isCurrent(turn: PromptTurn): boolean {
    return !deps.isDisposed() && turn.seq === deps.lifecycle.turnSeq
  }

  function publishedCompletion(seq: number, sessionId: SessionState["sessionId"]) {
    if (publishedTurn?.seq === seq && publishedTurn.sessionId === sessionId) {
      return publishedTurn.completion
    }
  }

  function finish(turn: PromptTurn, completion: PromptTurnCompletion): void {
    if (!isCurrent(turn)) return
    const state = deps.getState()
    const prior = turn.completion ?? publishedCompletion(turn.seq, state.sessionId)
    const visible = prior ?? completion
    const update = applyTurnEnd(state, visible.lastTurnError ?? undefined, visible.stopReason)
    if (prior) {
      // Clean up late output without a second event. A prompt for another
      // session still returns its own outcome to its caller.
      deps.emit(update)
      return
    }
    turn.completion = completion
    if (update.patches.length > 0) {
      publishedTurn = { seq: turn.seq, sessionId: state.sessionId, completion }
    }
    deps.emitTurnEnd(update, {
      ...completion,
      contextUsage: state.contextUsage,
      acpSessionId: state.sessionId,
    })
    if (completion.lastTurnError === null) deps.maybeScheduleCloseOnTurnEnd()
  }

  async function cancel(
    sessionId: string,
    adoptedTurn?: TurnIdentity & { lastTurnError: SessionState["lastTurnError"] },
  ): Promise<void> {
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

    const completion = { stopReason: "cancelled", lastTurnError: null }
    if (target) {
      if (!target.completion) finish(target, completion)
      return
    }
    if (!adoptedTurn || !isCurrent(adoptedTurn) || deps.isSwitching()) return
    const state = deps.getState()
    // An adopted/replayed turn can be active without a local prompt Promise. An
    // already completed turn can also look active after a late output chunk.
    if (
      state.sessionId === adoptedTurn.sessionId &&
      state.turnState !== "idle" &&
      state.lastTurnError === adoptedTurn.lastTurnError &&
      !publishedCompletion(adoptedTurn.seq, adoptedTurn.sessionId)
    ) {
      finish(adoptedTurn, completion)
    }
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

    cancel,

    cancelActiveTurn(): CancelActiveTurnOutcome {
      if (deps.isDisposed() || deps.isSwitching()) return "no-active-turn"
      const { sessionId, turnState, lastTurnError } = deps.getState()
      if (!sessionId || sessionId === SWITCHING_SESSION_ID || turnState === "idle") {
        return "no-active-turn"
      }
      const seq = deps.lifecycle.turnSeq
      if (requestedCancel?.sessionId !== sessionId || requestedCancel.seq !== seq) {
        // RPC can cancel a caller-supplied session ID. Keep MCP deduplication independent.
        requestedCancel = { seq, sessionId }
        const adoptedTurn = { seq, sessionId, lastTurnError }
        void cancel(sessionId, adoptedTurn).catch((err) => {
          log.warn({ err, sessionId, turnSeq: seq }, "cancel active turn failed")
        })
      }
      return "cancel-requested"
    },
  }
}
