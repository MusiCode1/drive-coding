import type { Patch, SessionState } from "@drive-coding/core/session"
import { applyPatch } from "@drive-coding/core/session"
import { applyPatchMutable, sessionMsgToBubble } from "$lib/session/apply-patch-mutable"
import { mapLocations, mapToolContent } from "$lib/session/map-tool-content"
import { readViewEmission, type SessionView, type ViewEmission } from "$lib/session/session-view"
import type { Bubble } from "$lib/types/bubble"
import type { HistoryMark } from "./history-mark"
import { historyMarkFromReset } from "./history-mark"
import type { HistoryState } from "./history-state.svelte"

export type HistoryIngestHost = {
  ingestView(): SessionView | null
  status: string
  error: string | null
  bubbles: Bubble[]
  sessionState: SessionState
  historyEpoch: number
  readonly historyMark: HistoryMark
  readonly history: HistoryState
  isLoadingHistory: boolean
  ingestOnSessionUpdate(n: { update: unknown }): void
  ingestSyncFromViewState(s: SessionState): void
  ingestNoteAgentActivity(): void
  ingestSetHistoryMark(m: HistoryMark): void
  ingestApplyHistoryState(s: NonNullable<ViewEmission["historyState"]>): void
}

export type HistoryIngestDeps = {
  getView: () => SessionView | null
  sessionSurface: { status: string; error: string | null }
  getBubbles: () => Bubble[]
  setBubbles: (b: Bubble[]) => void
  getSessionState: () => SessionState
  setSessionState: (s: SessionState) => void
  onSessionUpdate: (n: { update: unknown }) => void
  syncFromViewState: (state: SessionState) => void
  noteAgentActivity: () => void
  getHistoryEpoch: () => number
  setHistoryEpoch: (n: number) => void
  setHistoryMark: (m: HistoryMark) => void
  getHistoryMark: () => HistoryMark
  history: HistoryState
  setIsLoadingHistory: (v: boolean) => void
  applyHistoryState: (s: NonNullable<ViewEmission["historyState"]>) => void
}

export function historyIngestDepsFrom(host: HistoryIngestHost): HistoryIngestDeps {
  return {
    getView: () => host.ingestView(),
    sessionSurface: host,
    getBubbles: () => host.bubbles,
    setBubbles: (b) => {
      host.bubbles = b
    },
    getSessionState: () => host.sessionState,
    setSessionState: (s) => {
      host.sessionState = s
    },
    onSessionUpdate: (n) => host.ingestOnSessionUpdate(n),
    syncFromViewState: (s) => host.ingestSyncFromViewState(s),
    noteAgentActivity: () => host.ingestNoteAgentActivity(),
    getHistoryEpoch: () => host.historyEpoch,
    setHistoryEpoch: (n) => {
      host.historyEpoch = n
    },
    setHistoryMark: (m) => host.ingestSetHistoryMark(m),
    getHistoryMark: () => host.historyMark,
    history: host.history,
    setIsLoadingHistory: (v) => {
      host.isLoadingHistory = v
    },
    applyHistoryState: (s) => host.ingestApplyHistoryState(s),
  }
}

function prependHistory(
  deps: HistoryIngestDeps,
  messages: Extract<ViewEmission, { history: "older" }>["messages"],
): void {
  const state = deps.getSessionState()
  const existingMark = deps.getHistoryMark()
  const addedMark = historyMarkFromReset(messages)
  deps.history.onOlderApplying()
  deps.setBubbles([
    ...messages.map((message) => sessionMsgToBubble(message, { mapToolContent, mapLocations })),
    ...deps.getBubbles(),
  ])
  deps.setSessionState({ ...state, messages: [...messages, ...state.messages] })
  deps.setHistoryMark({
    segmentCounts: new Map([...existingMark.segmentCounts, ...addedMark.segmentCounts]),
    toolCallIds: [...new Set([...existingMark.toolCallIds, ...addedMark.toolCallIds])],
  })
  deps.setHistoryEpoch(deps.getHistoryEpoch() + 1)
}

export async function consumeViewPatches(
  deps: HistoryIngestDeps,
  view: SessionView,
): Promise<void> {
  const reader = view.patches.getReader()
  deps.syncFromViewState(view.state)
  let attachWindow = true
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (deps.getView() !== view) break

      const emission = readViewEmission(deps.sessionSurface, value)
      if (!emission) continue

      if (value?.historyState) {
        deps.applyHistoryState(value.historyState)
        deps.setIsLoadingHistory(value.historyState.reloading)
      }
      if (emission.activity === true) deps.noteAgentActivity()
      if (emission.history === "older") {
        prependHistory(deps, emission.messages)
        deps.syncFromViewState(view.state)
        // The next queued live append belongs to a separate virtualizer flush.
        await deps.history.onOlderApplied()
        continue
      }
      if (emission.history === "reset") deps.history.resetViewport()

      const patches = emission.patches
      const resetPatches = patches.filter(
        (p): p is Extract<Patch, { op: "reset" }> => p.op === "reset",
      )
      if (resetPatches.length > 0) {
        const bubbles = deps.getBubbles()
        applyPatchMutable(bubbles, resetPatches, { mapToolContent, mapLocations })
        deps.setBubbles(bubbles)
        for (const patch of resetPatches) {
          const next = applyPatch(deps.getSessionState(), patch)
          if (next) deps.setSessionState(next)
        }
        const bumpEpoch =
          attachWindow || emission.history === "tail" || emission.history === "reset"
        if (bumpEpoch) {
          attachWindow = false
          const reset = resetPatches[0]
          if (reset) {
            deps.setHistoryMark(historyMarkFromReset(reset.messages))
            deps.setHistoryEpoch(deps.getHistoryEpoch() + 1)
          }
        }
      }

      for (const update of emission.updates) {
        deps.onSessionUpdate({ update } as { update: unknown })
      }

      deps.syncFromViewState(view.state)
    }
  } catch {
    // stream closed or aborted
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* */
    }
  }
}
