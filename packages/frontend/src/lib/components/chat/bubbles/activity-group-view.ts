import type { Bubble } from "$lib/types/bubble"
import { normalizeToolCall } from "$lib/util/tool-call-view"

export function countActivityKinds(bubbles: readonly Bubble[]): {
  toolCount: number
  thoughtCount: number
} {
  let toolCount = 0
  let thoughtCount = 0
  for (const b of bubbles) {
    if (b.kind === "tool") toolCount++
    else if (b.kind === "thought") thoughtCount++
  }
  return { toolCount, thoughtCount }
}

/** Up to 5 unique tool kinds in run order. */
export function uniqueToolKinds(bubbles: readonly Bubble[], limit = 5): string[] {
  const seen = new Set<string>()
  const kinds: string[] = []
  for (const b of bubbles) {
    if (b.kind !== "tool") continue
    const k = b.toolCall.kind ?? "other"
    if (seen.has(k)) continue
    seen.add(k)
    kinds.push(k)
    if (kinds.length >= limit) break
  }
  return kinds
}

export function activityGroupLastSummary(bubbles: readonly Bubble[], thoughtLabel: string): string {
  const b = bubbles.at(-1)
  if (!b) return ""
  if (b.kind === "thought") return thoughtLabel
  if (b.kind === "tool") {
    const tc = b.toolCall
    return normalizeToolCall(tc, { narration: tc.narration }).summary
  }
  return ""
}

export function isLastBubbleInProgress(bubbles: readonly Bubble[]): boolean {
  const b = bubbles.at(-1)
  return b?.kind === "tool" && b.toolCall.status === "in_progress"
}
