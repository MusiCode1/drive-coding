import { connWarn } from "$lib/util/conn-log"
import { shouldReloadOnReconnect } from "./history-reload"
import { legacyReconnect } from "./history-sync-emit"
import type { HistorySyncPort } from "./history-sync-port"
import type { OpeningFrame } from "./wire/frame-decode"

export function planReconnect(
  port: HistorySyncPort,
  opening: OpeningFrame,
  prevSession: string | null,
  prevVersion: number,
): "legacy" | "noop" | "reload" | "reset" {
  const reason = shouldReloadOnReconnect(prevSession ?? "", opening, prevVersion)
  if (!reason && opening.historyOmitted === undefined) return "legacy"
  if (!reason) {
    if (opening.state.version < prevVersion) {
      connWarn("sse-version-regression", {
        got: opening.state.version,
        have: prevVersion,
        sessionId: opening.state.sessionId,
      })
    }
    return "noop"
  }
  return reason === "reset" ? "reset" : "reload"
}

export function applyLegacyReconnect(port: HistorySyncPort, opening: OpeningFrame): void {
  legacyReconnect(port, opening.state)
}
