/** Wires session-end boundary to audio teardown. Returns unsubscribe. Structural params for test doubles. */
export function bindSessionScope(deps: {
  session: { onSessionEnd?(cb: (reason: string) => void): () => void }
  speaker: { stop(): void }
  orderAlloc: { clear(): void }
}): () => void {
  const register = deps.session.onSessionEnd
  if (typeof register !== "function") return () => {}
  return register((_reason) => {
    deps.speaker.stop()
    deps.orderAlloc.clear()
  })
}
