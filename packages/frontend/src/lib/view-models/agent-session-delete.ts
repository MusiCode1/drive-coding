import type { SessionView } from "$lib/session/session-view"
import type { SessionEndReason } from "$lib/view-models/agent-session-session-end"
import type { SessionsCacheScope } from "$lib/view-models/sessions-cache-scope.svelte"

export type DeleteSessionDeps = {
  view: () => SessionView | null
  sessionId: () => string | null
  cache: () => SessionsCacheScope
  detachWith: (reason: SessionEndReason) => void
}

/**
 * מוחק סשן מ-`session/list`. מחזיר `true` אם נמחק הסשן ה**פעיל** — כדי שהקומפוננטה
 * תנווט החוצה (`goto("/")`), עקבי עם דפוס `onDisconnect`/`doLeaveRunning` שבו הניווט
 * חי בשכבת הקומפוננטה ולא ב-VM. (calev NO-GO fix: DoD #7 — active-delete השאיר /chat ריק.)
 */
export async function deleteSession(d: DeleteSessionDeps, sessionId: string): Promise<boolean> {
  const view = d.view()
  if (!view) return false

  try {
    await view.deleteSession(sessionId)
  } catch (e) {
    if ((e as { code?: number }).code === -32601) return false // button hidden; defensive no-op
    d.cache().setError(e)
    return false
  }
  // optimistic removal (the RPC confirmed the delete)
  d.cache().remove(sessionId)
  const wasActive = sessionId === d.sessionId()
  if (wasActive) {
    d.detachWith("delete")
  }
  return wasActive
}
