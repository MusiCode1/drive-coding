import type { Bubble, SubFrame, ToolBubble } from "$lib/types/bubble"

/** Locate a ToolBubble by `toolCallId` anywhere in the bubble tree (top-level + nested subFrames). */
export function findToolBubble(
  bubbles: readonly Bubble[],
  toolCallId: string,
): ToolBubble | undefined {
  for (const b of bubbles) {
    if (b.kind !== "tool") continue
    if (b.toolCall.toolCallId === toolCallId) return b
    if (b.subFrames !== undefined) {
      const nested = findToolBubbleInSubFrames(b.subFrames, toolCallId)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function findToolBubbleInSubFrames(
  frames: readonly SubFrame[],
  toolCallId: string,
): ToolBubble | undefined {
  for (const sf of frames) {
    if (sf.kind !== "tool") continue
    if (sf.toolCall.toolCallId === toolCallId) return sf
    if (sf.subFrames !== undefined) {
      const nested = findToolBubbleInSubFrames(sf.subFrames, toolCallId)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * Immutable map over a ToolBubble matched by `toolCallId`.
 * When no match exists, returns an equivalent structure without calling `fn`.
 */
export function mapToolBubble(
  bubbles: readonly Bubble[],
  toolCallId: string,
  fn: (b: ToolBubble) => ToolBubble,
): Bubble[] {
  let changed = false
  const result = bubbles.map((b) => {
    if (b.kind !== "tool") return b
    if (b.toolCall.toolCallId === toolCallId) {
      changed = true
      return fn(b)
    }
    if (b.subFrames !== undefined && b.subFrames.length > 0) {
      const newSubFrames = mapSubFrames(b.subFrames, toolCallId, fn)
      if (newSubFrames !== b.subFrames) {
        changed = true
        return { ...b, subFrames: newSubFrames }
      }
    }
    return b
  })
  return changed ? result : [...bubbles]
}

function mapSubFrames(
  frames: readonly SubFrame[],
  toolCallId: string,
  fn: (b: ToolBubble) => ToolBubble,
): SubFrame[] {
  let changed = false
  const result = frames.map((sf) => {
    if (sf.kind !== "tool") return sf
    if (sf.toolCall.toolCallId === toolCallId) {
      changed = true
      return fn(sf)
    }
    if (sf.subFrames !== undefined && sf.subFrames.length > 0) {
      const newSubFrames = mapSubFrames(sf.subFrames, toolCallId, fn)
      if (newSubFrames !== sf.subFrames) {
        changed = true
        return { ...sf, subFrames: newSubFrames }
      }
    }
    return sf
  })
  return changed ? result : (frames as SubFrame[])
}
