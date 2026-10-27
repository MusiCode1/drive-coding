/**
 * Bridges SessionHistoryStore to the legacy TokenUsageStore surface (removed in Commit 5).
 */

import type { TokenUsageStore } from "../usage/token-usage-store.js"
import type { SessionHistoryStore } from "./session-history-store.js"

export function asTokenUsageStore(history: SessionHistoryStore): TokenUsageStore {
  return {
    ingestUsageUpdate: (p) => history.ingestUsageUpdate(p),
    onTurnEnded: (agentId, acpSessionId, now) => history.onTurnEnded(agentId, acpSessionId, now),
    listRecords: (opts) => history.listUsageRecords(opts),
    flushOnShutdown: () => {},
  }
}
