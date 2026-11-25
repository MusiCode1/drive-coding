import type { SessionState } from "@drive-coding/core/session"
import { shouldReloadOnReconnect } from "./history-reload"
import { emitHistoryState, legacyReconnect } from "./history-sync-emit"
import { triggerHistoryReload } from "./history-sync-trigger"
import { defaultWindow } from "./history-window"
import type { OpeningFrame } from "./wire/frame-decode"

type ReloadInput = { tag: "reload" | "reset"; seed: SessionState }
type ReloadOptions = Omit<
  Parameters<typeof triggerHistoryReload>[0],
  keyof ReloadInput | "setError" | "setReloading" | "signal"
>

export class HistoryReload {
  input?: ReloadInput
  error: string | null = null
  reloading = false

  constructor(private readonly opts: ReloadOptions) {}

  run(input: ReloadInput, signal: AbortSignal): Promise<boolean> {
    this.input = input
    return triggerHistoryReload({
      ...this.opts,
      ...input,
      signal,
      setError: (error) => {
        this.error = error
      },
      setReloading: (reloading) => {
        this.reloading = reloading
      },
    })
  }

  finishLegacy(opening: OpeningFrame, begin: () => void, clearFloors: () => void): void {
    const { port, emitCtx, setWindow, gate } = this.opts
    const previous = emitCtx()
    begin()
    const replaced = legacyReconnect(port, opening.state)
    if (replaced) {
      setWindow(defaultWindow(opening.state.version))
      clearFloors()
    }
    this.input = undefined
    this.error = null
    this.reloading = false
    gate.open()
    if (
      (replaced && previous.window.hasMore) ||
      previous.reloading ||
      previous.error !== null ||
      previous.loadingOlder ||
      previous.olderError !== null
    ) {
      emitHistoryState(port, emitCtx())
    }
  }
}

export function planReconnect(
  opening: OpeningFrame,
  prevSession: string | null,
  prevVersion: number,
): "legacy" | "noop" | "reload" | "reset" {
  if (!opening.historyOmitted) return "legacy"
  return shouldReloadOnReconnect(prevSession, opening, prevVersion) ?? "noop"
}
