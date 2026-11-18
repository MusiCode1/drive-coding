/**
 * live-dispatch.ts — pure prompt dispatch gate (mirrors AgentSession.sendPrompt guards).
 *
 * Slice: live-secretary, Commit 0.
 */

export type DispatchVerdict =
  | { ok: true }
  | { ok: false; reason: "not-connected" | "no-session" | "empty-text" }

export function canDispatchPrompt(input: {
  status: string
  hasClient: boolean
  hasSessionId: boolean
  isRemoteView: boolean
  text: string
}): DispatchVerdict {
  if (input.status !== "connected") {
    return { ok: false, reason: "not-connected" }
  }
  if (!input.isRemoteView && (!input.hasClient || !input.hasSessionId)) {
    return { ok: false, reason: "no-session" }
  }
  if (!input.text.trim()) {
    return { ok: false, reason: "empty-text" }
  }
  return { ok: true }
}
