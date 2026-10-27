import type { BridgeKind } from "@drive-coding/core"

/** Folder row shape shared by CLI usage aggregation and HTTP projection. */
export type ProjectEntry = {
  readonly cwd: string
  readonly kind: BridgeKind
  readonly lastSeen: string
  readonly lastSessionId?: string
}
