/** slice session-scope-core S1 — reason passed to onSessionEnd listeners. "navigate" reserved for S2. */
export type SessionEndReason =
  | "detach"
  | "leave-running"
  | "switch"
  | "new"
  | "load"
  | "delete"
  | "navigate"

export type SessionEndScopeDeps = {
  sessionEndListeners: () => Array<(reason: SessionEndReason) => void>
}

/** Registers a listener for session-scope end. Returns unsubscribe. Listeners run in registration order. */
export function registerSessionEndListener(
  d: SessionEndScopeDeps,
  cb: (reason: SessionEndReason) => void,
): () => void {
  d.sessionEndListeners().push(cb)
  return () => {
    const i = d.sessionEndListeners().indexOf(cb)
    if (i >= 0) d.sessionEndListeners().splice(i, 1)
  }
}

export function endSessionScope(d: SessionEndScopeDeps, reason: SessionEndReason): void {
  for (const cb of d.sessionEndListeners()) {
    try {
      cb(reason)
    } catch {
      // one listener must not break teardown
    }
  }
}
