/**
 * live-seed-from-session.ts — map AgentSession bubbles → LiveSeedBubble[].
 *
 * Thoughts are dropped (redaction). Tool status encodes failure as "!name".
 * Slice: live-context wiring (orphans).
 */

import type { LiveSeedBubble, LiveSeedInput } from "@drive-coding/core/voice/live-seed"
import type { Bubble } from "$lib/types/bubble"
import type { TurnState } from "$lib/view-models/agent-session.svelte"

/** Model-facing meta lines (silent context) — English, not UI i18n. */
export const LIVE_SEED_LABELS = {
  toolRan: (name: string) => `[tool ran: ${name}]`,
  toolFailed: (name: string) => `[tool failed: ${name}]`,
  permissionPending: "[permission pending]",
  agentRunning: "[agent running]",
  agentIdle: "[agent idle]",
} as const

export function mapBubblesToLiveSeed(bubbles: readonly Bubble[]): LiveSeedBubble[] {
  const out: LiveSeedBubble[] = []
  let turnIndex = 0
  for (const bubble of bubbles) {
    if (bubble.kind === "thought") continue
    if (bubble.kind === "user") {
      const text = bubble.segments.map((s) => s.text).join("")
      if (text.length === 0) continue
      out.push({ kind: "user", text, turnIndex: turnIndex++ })
      continue
    }
    if (bubble.kind === "message") {
      const text = bubble.segments.map((s) => s.text).join("")
      if (text.length === 0) continue
      out.push({ kind: "assistant", text, turnIndex: turnIndex++ })
      continue
    }
    // tool
    const name = bubble.toolCall.name || bubble.toolCall.title || bubble.toolCall.kind || "tool"
    const failed = bubble.toolCall.status === "failed"
    out.push({
      kind: "tool",
      text: failed ? `!${name}` : name,
      turnIndex: turnIndex++,
    })
  }
  return out
}

export function mapSessionTurnState(
  turnState: TurnState,
  hasPendingPermission: boolean,
): LiveSeedInput["turnState"] {
  if (hasPendingPermission) return "awaiting-permission"
  if (turnState === "idle") return "idle"
  return "running"
}
