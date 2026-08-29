/** Wires session-end boundary to audio teardown. Returns unsubscribe. Structural params for test doubles. */
export function bindSessionScope(deps: {
  session: { onSessionEnd(cb: (reason: import("$lib/view-models/agent-session.svelte").SessionEndReason) => void): () => void }
  speaker: { stop(): void }
  orderAlloc: { clear(): void }
}): () => void {
  return deps.session.onSessionEnd((_reason) => {
    deps.speaker.stop()
    deps.orderAlloc.clear()
  })
}
