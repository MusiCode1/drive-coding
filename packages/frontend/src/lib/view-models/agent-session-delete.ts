import type { AcpClient } from "@drive-coding/provider/client"
import type { SessionInfo } from "$lib/adapters/sessions"
import type { SessionView } from "$lib/session/session-view"
import type { SessionEndReason } from "$lib/view-models/agent-session-session-end"

export type DeleteSessionDeps = {
  remoteView: () => SessionView | null
  client: () => AcpClient | null
  sessionId: () => string | null
  sessions: () => SessionInfo[]
  setSessions: (v: SessionInfo[]) => void
  setSessionsError: (v: string | null) => void
  detachWith: (reason: SessionEndReason) => void
}

/**
 * מוחק סשן מ-`session/list`. מחזיר `true` אם נמחק הסשן ה**פעיל** — כדי שהקומפוננטה
 * תנווט החוצה (`goto("/")`), עקבי עם דפוס `onDisconnect`/`doLeaveRunning` שבו הניווט
 * חי בשכבת הקומפוננטה ולא ב-VM. (calev NO-GO fix: DoD #7 — active-delete השאיר /chat ריק.)
 */
export async function deleteSession(d: DeleteSessionDeps, sessionId: string): Promise<boolean> {
  // ─── slice remote-session-mgmt C5: remote path — view.deleteSession ───
  const remoteView = d.remoteView()
  if (remoteView) {
    try {
      await remoteView.deleteSession(sessionId)
    } catch (e) {
      if ((e as { code?: number }).code === -32601) return false // button hidden; defensive no-op
      d.setSessionsError(e instanceof Error ? e.message : String(e))
      return false
    }
    // optimistic removal — same as local (the rpc already confirmed the delete)
    d.setSessions(d.sessions().filter((s) => s.sessionId !== sessionId))
    const wasActive = sessionId === d.sessionId()
    if (wasActive) {
      d.detachWith("delete") // navigates out — same wasActive logic as local
    }
    return wasActive
  }
  if (d.client() === null) return false
  try {
    await d.client()!.deleteSession(sessionId)
  } catch (e) {
    if ((e as { code?: number }).code === -32601) return false // הכפתור מוסתר; defensive no-op
    d.setSessionsError(e instanceof Error ? e.message : String(e))
    return false
  }
  // הסרה אופטימית — ה-ACP call כבר אישר את המחיקה, אין צורך בעוד round-trip (listSessions(true)).
  d.setSessions(d.sessions().filter((s) => s.sessionId !== sessionId))
  const wasActive = sessionId === d.sessionId()
  if (wasActive) {
    d.detachWith("delete") // מנקה גם sessions/sessionsLoaded/sessionsError — עקבי עם onDisconnect
  }
  return wasActive // הקומפוננטה מנווטת החוצה כשזה true
}
