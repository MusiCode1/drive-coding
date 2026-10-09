import type { SessionHistoryStore } from "../history/session-history-store.js"

export function listProjectsForApi(store: SessionHistoryStore) {
  return store.listProjects().map((p) => ({
    cwd: p.cwd,
    kind: p.kind,
    lastSeen: p.lastSeen,
    ...(p.lastSessionId !== undefined ? { lastSessionId: p.lastSessionId } : {}),
    sessionCount: p.sessionCount,
  }))
}
