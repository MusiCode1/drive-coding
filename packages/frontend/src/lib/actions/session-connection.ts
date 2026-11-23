import type { AgentSession } from "$lib/view-models/agent-session.svelte"

export function connectionFailed(session: AgentSession): boolean {
  return session.status !== "connected" || session.error !== null
}
