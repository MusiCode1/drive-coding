import { tick } from "svelte"
import type { HistoryController, HistoryWindowState, ViewEmission } from "$lib/session/session-view"

type OlderObserver = {
  onApplying(): void
  onApplied(): void
  reset(): void
}

const emptyWindow = (): HistoryWindowState => ({
  firstSeq: null,
  lastSeq: null,
  hasMore: false,
  watermark: 0,
})

export class HistoryState {
  window = $state<HistoryWindowState>(emptyWindow())
  error = $state<string | null>(null)
  reloading = $state(false)
  loadingOlder = $state(false)
  olderError = $state<string | null>(null)
  shiftNext = $state(false)
  #olderObserver?: OlderObserver
  #controller: HistoryController | null = null

  bind(controller: HistoryController): void {
    this.#controller = controller
    this.pullFromController()
  }

  resetFields(): void {
    this.resetViewport()
    this.window = emptyWindow()
    this.error = null
    this.reloading = false
    this.loadingOlder = false
    this.olderError = null
    this.#controller = null
  }

  observeOlder(observer: OlderObserver): () => void {
    this.#olderObserver = observer
    return () => {
      if (this.#olderObserver === observer) this.#olderObserver = undefined
    }
  }

  resetViewport(): void {
    this.shiftNext = false
    this.#olderObserver?.reset()
  }

  onOlderApplying(): void {
    this.#olderObserver?.onApplying()
    this.shiftNext = true
  }

  async onOlderApplied(): Promise<void> {
    this.#olderObserver?.onApplied()
    await tick()
    this.shiftNext = false
  }

  pullFromController(): void {
    const c = this.#controller
    if (!c) return
    this.applyEmission(c)
  }

  applyEmission(state: NonNullable<ViewEmission["historyState"]>): void {
    this.window = { ...state.window }
    this.error = state.error
    this.reloading = state.reloading
    this.loadingOlder = state.loadingOlder
    this.olderError = state.olderError
  }

  loadOlder(): Promise<void> {
    return this.#controller?.loadOlder() ?? Promise.resolve()
  }

  retry(): Promise<void> {
    return this.#controller?.retry() ?? Promise.resolve()
  }
}

export function bindHistory(state: HistoryState, view: { history: HistoryController }): void {
  state.bind(view.history)
  state.pullFromController()
}
