import type { SessionInfo } from "$lib/adapters/sessions"
import type { SessionView } from "./session-view"

export async function findListedSession(
  view: Pick<SessionView, "listSessions">,
  sessionId: string,
  isCurrent: () => boolean,
): Promise<SessionInfo | undefined> {
  const consumed = new Set<string>()
  let cursor: string | undefined
  while (isCurrent()) {
    try {
      const page = await view.listSessions(cursor === undefined ? {} : { cursor })
      if (!isCurrent()) return
      const match = page.sessions.find((item) => item.sessionId === sessionId)
      if (match) return match
      cursor = page.nextCursor
      if (cursor === undefined || consumed.has(cursor)) return
      consumed.add(cursor)
    } catch (e) {
      if (!isCurrent() || (e as { code?: number } | null)?.code === -32601) return
      throw e
    }
  }
}
