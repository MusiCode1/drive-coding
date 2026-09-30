import { beforeNavigate } from "$app/navigation"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import { bindSessionScope } from "./session-scope"
import { onSessionRouteChange } from "./session-scope-nav"

export function bindSessionLifecycle(deps: {
  session: AgentSession
  speaker: { stop(): void }
  orderAlloc: { clear(): void }
  presencePoller: { onSseReconnected(): void }
}): () => void {
  const { session, speaker, orderAlloc, presencePoller } = deps
  session.bindConnectionRelease()
  session.setSseReconnectedListener(() => presencePoller.onSseReconnected())
  const unbindScope = bindSessionScope({ session, speaker, orderAlloc })
  beforeNavigate((nav) => {
    onSessionRouteChange(nav.from?.url.pathname ?? "", nav.to?.url.pathname, session)
  })
  return () => {
    unbindScope()
    session.setSseReconnectedListener(null)
  }
}
