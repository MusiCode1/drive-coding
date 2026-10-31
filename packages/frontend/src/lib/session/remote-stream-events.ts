import type { SessionState, WireSessionUpdate } from "@drive-coding/core/session"

export type RemoteSource = Readonly<{ hostIncarnation: string; token: object }>
export type WireUpdateBatch = { version: number; updates: WireSessionUpdate[] }
export type RemoteSnapshot = { kind: "snapshot"; source: RemoteSource; state: SessionState }
export type RemoteTerminal = {
  kind: "terminal"
  source: RemoteSource
  reason: "unavailable" | "taken-over" | "protocol-error"
}
export type RemoteStreamEvent =
  | RemoteSnapshot
  | RemoteTerminal
  | { kind: "update"; source: RemoteSource; batch: WireUpdateBatch }
