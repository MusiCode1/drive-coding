/**
 * live-seed-from-session.ts — map AgentSession bubbles → LiveSeedBubble[].
 *
 * Thoughts are dropped (redaction). Tool status encodes failure as "!name".
 * Slice: live-context wiring (orphans).
 */

import type { LiveSeedBubble, LiveSeedInput } from "@drive-coding/core/voice/live-seed"
import type { RecentItem } from "@drive-coding/core/voice/live-read-recent"
import type { Bubble, ToolCall, ToolContent } from "$lib/types/bubble"
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

function jsonPreview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function formatToolContent(part: ToolContent): string {
  switch (part.type) {
    case "text":
      return part.text
    case "diff":
      return `${part.path}\n${part.newText}`
    case "terminal":
      return `[terminal ${part.terminalId}]`
    case "image":
      return "[image]"
    case "other":
      return ""
  }
}

function toolOutput(call: ToolCall): string | undefined {
  if (call.content && call.content.length > 0) {
    const parts = call.content.map(formatToolContent).filter((s) => s.length > 0)
    if (parts.length > 0) return parts.join("\n")
  }
  return jsonPreview(call.result)
}

function toolName(call: ToolCall): string {
  return call.name || call.title || call.kind || "tool"
}

/** Lossless recent-history map — thoughts kept, tools keep args/output. Filtering is in core. */
export function mapBubblesToRecent(bubbles: readonly Bubble[]): RecentItem[] {
  const out: RecentItem[] = []
  let turnIndex = 0
  for (const bubble of bubbles) {
    if (bubble.kind === "thought") {
      const text = bubble.segments.map((s) => s.text).join("")
      if (text.length === 0) continue
      out.push({ role: "thought", text, turnIndex: turnIndex++ })
      continue
    }
    if (bubble.kind === "user") {
      const text = bubble.segments.map((s) => s.text).join("")
      if (text.length === 0) continue
      out.push({ role: "user", text, turnIndex: turnIndex++ })
      continue
    }
    if (bubble.kind === "message") {
      const text = bubble.segments.map((s) => s.text).join("")
      if (text.length === 0) continue
      out.push({ role: "assistant", text, turnIndex: turnIndex++ })
      continue
    }
    const name = toolName(bubble.toolCall)
    const failed = bubble.toolCall.status === "failed"
    const args = jsonPreview(bubble.toolCall.args)
    const output = toolOutput(bubble.toolCall)
    out.push({
      role: "tool",
      text: failed ? `!${name}` : name,
      turnIndex: turnIndex++,
      tool: {
        name,
        status: bubble.toolCall.status,
        ...(args !== undefined ? { args } : {}),
        ...(output !== undefined ? { output } : {}),
      },
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
