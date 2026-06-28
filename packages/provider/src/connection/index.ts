/**
 * connection/index.ts — barrel for ProviderConnection primitive (CUT-3b-i).
 *
 * Re-exports shared wire utilities so consumers (bridge-manager, ws-agent) can
 * import from @drive-coding/provider/connection instead of internal paths.
 *
 * connectSpawn and ProviderConnection types are added in CUT-3b-i commits 1 & 2.
 */

// Shared wire utilities (moved from backend in CUT-3b-i commit 0)
export { decodeWireLine } from "../shared/wire-decode.js"
export type { WireSummary } from "../shared/wire-decode.js"
export { createTurnTracker } from "../shared/turn-tracker.js"
export type { TurnTracker } from "../shared/turn-tracker.js"
