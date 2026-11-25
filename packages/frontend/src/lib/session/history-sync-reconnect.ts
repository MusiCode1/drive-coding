import { shouldReloadOnReconnect } from "./history-reload"
import { legacyReconnect } from "./history-sync-emit"
import type { HistorySyncPort } from "./history-sync-port"
import type { OpeningFrame } from "./wire/frame-decode"

export function planReconnect(
  opening: OpeningFrame,
  prevSession: string | null,
  prevVersion: number,
): "legacy" | "noop" | "reload" | "reset" {
  if (!opening.historyOmitted) return "legacy"
  return shouldReloadOnReconnect(prevSession, opening, prevVersion) ?? "noop"
}

export function applyLegacyReconnect(port: HistorySyncPort, opening: OpeningFrame): void {
  legacyReconnect(port, opening.state)
}
