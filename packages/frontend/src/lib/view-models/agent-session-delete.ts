import { failedPromptStore } from "$lib/adapters/failed-prompt-store"
import { promptOwner } from "$lib/engines/prompt-payload"
import type { SessionView } from "$lib/session/session-view"
import type { SessionEndReason } from "$lib/view-models/agent-session-session-end"
import type { SessionsCacheScope } from "$lib/view-models/sessions-cache-scope.svelte"

export type DeleteSessionDeps = {
  view: () => SessionView | null
  sessionId: () => string | null
  cache: () => SessionsCacheScope
  cliKind: () => string | null
  detachWith: (reason: SessionEndReason) => void
  onActivePromptCleanupFailed: () => void
}

/**
 * מוחק סשן מ-`session/list`. מחזיר `true` אם נמחק הסשן ה**פעיל** — כדי שהקומפוננטה
 * תנווט החוצה (`goto("/")`), עקבי עם דפוס `onDisconnect`/`doLeaveRunning` שבו הניווט
 * חי בשכבת הקומפוננטה ולא ב-VM. (calev NO-GO fix: DoD #7 — active-delete השאיר /chat ריק.)
 */
export async function deleteSession(d: DeleteSessionDeps, sessionId: string): Promise<boolean> {
  const view = d.view()
  if (!view) return false

  const cliKind = d.cliKind()
  const backend = view.targetIdentity?.backendBaseUrl
  const owner = cliKind && backend ? promptOwner(backend, cliKind, sessionId) : undefined

  try {
    await view.deleteSession(sessionId)
  } catch (e) {
    if (d.view() !== view) return false
    if ((e as { code?: number } | null)?.code === -32601) d.cache().rejectDelete(view)
    else d.cache().setError(e)
    return false
  }
  const cleaned = owner === undefined || (await failedPromptStore.deleteOwner(owner))
  if (d.view() !== view) return false
  d.cache().remove(view, sessionId)
  const wasActive = sessionId === d.sessionId()
  if (wasActive) {
    d.detachWith("delete")
  }
  if (!cleaned) {
    d.cache().setError(new Error("Could not clear saved prompt after session deletion"))
    if (wasActive) d.onActivePromptCleanupFailed()
  }
  return wasActive
}
