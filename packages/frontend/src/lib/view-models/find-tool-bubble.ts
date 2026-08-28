import type { Bubble, SubFrame, ToolBubble } from "$lib/types/bubble"

/** Recursively locate a ToolBubble by `toolCall.toolCallId` (top-level bubbles, then subFrames). */
export function findToolBubble(
  bubbles: readonly Bubble[],
  toolCallId: string,
): ToolBubble | undefined {
  for (const b of bubbles) {
    if (b.kind === "tool" && b.toolCall.toolCallId === toolCallId) {
      return b
    }
    if (b.kind === "tool" && b.subFrames !== undefined) {
      const found = findToolBubbleInSubFrames(b.subFrames, toolCallId)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function findToolBubbleInSubFrames(
  frames: readonly SubFrame[],
  toolCallId: string,
): ToolBubble | undefined {
  for (const sf of frames) {
    if (sf.kind === "tool" && sf.toolCall.toolCallId === toolCallId) {
      return sf
    }
    if (sf.kind === "tool" && sf.subFrames !== undefined) {
      const found = findToolBubbleInSubFrames(sf.subFrames, toolCallId)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function mapSubFrames(
  frames: readonly SubFrame[],
  toolCallId: string,
  fn: (b: ToolBubble) => ToolBubble,
): SubFrame[] {
  let changed = false
  const result: SubFrame[] = []
  for (const sf of frames) {
    if (sf.kind === "tool" && sf.toolCall.toolCallId === toolCallId) {
      changed = true
      result.push(fn(sf))
    } else if (sf.kind === "tool" && sf.subFrames !== undefined) {
      const newSubFrames = mapSubFrames(sf.subFrames, toolCallId, fn)
      if (newSubFrames !== sf.subFrames) {
        changed = true
        result.push({ ...sf, subFrames: newSubFrames })
      } else {
        result.push(sf)
      }
    } else {
      result.push(sf)
    }
  }
  return changed ? result : (frames as SubFrame[])
}

/** Immutable map: apply `fn` to the ToolBubble matching `toolCallId`; no-op if not found. */
export function mapToolBubble(
  bubbles: readonly Bubble[],
  toolCallId: string,
  fn: (b: ToolBubble) => ToolBubble,
): Bubble[] {
  let changed = false
  const result: Bubble[] = []
  for (const b of bubbles) {
    if (b.kind === "tool" && b.toolCall.toolCallId === toolCallId) {
      changed = true
      result.push(fn(b))
    } else if (b.kind === "tool" && b.subFrames !== undefined) {
      const newSubFrames = mapSubFrames(b.subFrames, toolCallId, fn)
      if (newSubFrames !== b.subFrames) {
        changed = true
        result.push({ ...b, subFrames: newSubFrames })
      } else {
        result.push(b)
      }
    } else {
      result.push(b)
    }
  }
  return changed ? result : (bubbles as Bubble[])
}
