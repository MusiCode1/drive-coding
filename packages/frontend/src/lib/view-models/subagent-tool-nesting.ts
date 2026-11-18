import { mapLocations, mapToolContent } from "$lib/session/map-tool-content"
import type { Bubble, ToolBubble, ToolCall } from "$lib/types/bubble"
import { safeUUID } from "$lib/util/uuid"

export type SubagentToolCallInput = {
  toolCallId?: string
  title?: string
  kind?: string
  rawInput?: unknown
  rawOutput?: unknown
  status?: ToolCall["status"]
  content?: unknown[] | null
  locations?: unknown[] | null
}

export type SubagentToolCallUpdateInput = {
  toolCallId?: string
  status?: ToolCall["status"]
  rawInput?: unknown
  rawOutput?: unknown
  kind?: string
  title?: string
  content?: unknown[] | null
  locations?: unknown[] | null
}

export type SubagentToolNestingDeps = {
  bubbles: () => Bubble[]
  parents: () => Map<string, string>
  turnEnded: () => boolean
  applyToolCall: (update: Record<string, unknown>) => void
  setTurnState: (state: "idle" | "waiting" | "thinking" | "responding" | "calling-tool") => void
  scheduleIdle: () => void
}

export function handleSubagentToolCall(
  deps: SubagentToolNestingDeps,
  update: SubagentToolCallInput,
  parentToolUseId: string,
): void {
  if (update.toolCallId === undefined) return
  const bubbles = deps.bubbles()
  const parentIdx = bubbles.findIndex(
    (b) => b.kind === "tool" && b.toolCall.toolCallId === parentToolUseId,
  )
  const parent = parentIdx === -1 ? undefined : bubbles[parentIdx]
  if (parent === undefined || parent.kind !== "tool") {
    deps.applyToolCall(update as Record<string, unknown>)
    return
  }

  const childBubble: ToolBubble = {
    id: safeUUID(),
    kind: "tool",
    messageId: null,
    createdAt: Date.now(),
    toolCall: {
      toolCallId: update.toolCallId,
      name: update.kind ?? update.title ?? "tool",
      kind: update.kind,
      args: update.rawInput ?? {},
      status: update.status ?? "pending",
      title: update.title,
      narration: undefined,
      result: update.rawOutput,
      content: update.content != null ? mapToolContent(update.content) : undefined,
      locations: update.locations != null ? mapLocations(update.locations) : undefined,
    },
    segments: [],
  }

  bubbles[parentIdx] = {
    ...parent,
    subFrames: [...(parent.subFrames ?? []), childBubble],
  }
  deps.parents().set(update.toolCallId, parentToolUseId)
  deps.setTurnState("calling-tool")
  if (deps.turnEnded()) deps.scheduleIdle()
}

export function handleSubagentToolCallUpdate(
  deps: SubagentToolNestingDeps,
  update: SubagentToolCallUpdateInput,
): void {
  if (update.toolCallId === undefined) return
  if (update.status === "pending" || update.status === "in_progress") {
    deps.setTurnState("calling-tool")
    if (deps.turnEnded()) deps.scheduleIdle()
  }
  const parentToolUseId = deps.parents().get(update.toolCallId)
  if (parentToolUseId === undefined) return
  const bubbles = deps.bubbles()
  const parentIdx = bubbles.findIndex(
    (b) => b.kind === "tool" && b.toolCall.toolCallId === parentToolUseId,
  )
  const parent = parentIdx === -1 ? undefined : bubbles[parentIdx]
  if (parent === undefined || parent.kind !== "tool") return

  const subFrames = parent.subFrames ?? []
  const childIdx = subFrames.findIndex(
    (sf) => sf.kind === "tool" && sf.toolCall.toolCallId === update.toolCallId,
  )
  if (childIdx === -1) return
  const oldChild = subFrames[childIdx]
  if (oldChild === undefined || oldChild.kind !== "tool") return

  const newToolCall: ToolCall = {
    ...oldChild.toolCall,
    ...(update.status !== undefined && { status: update.status }),
    ...(update.rawInput !== undefined && { args: update.rawInput }),
    ...(update.rawOutput !== undefined && { result: update.rawOutput }),
    ...(update.kind !== undefined && { kind: update.kind }),
    ...(update.title !== undefined && { title: update.title }),
    ...(update.content !== undefined && {
      content: update.content === null ? undefined : mapToolContent(update.content),
    }),
    ...(update.locations !== undefined && {
      locations: update.locations === null ? undefined : mapLocations(update.locations),
    }),
  }
  const newChild: ToolBubble = { ...oldChild, toolCall: newToolCall }
  const newSubFrames = [...subFrames]
  newSubFrames[childIdx] = newChild
  bubbles[parentIdx] = { ...parent, subFrames: newSubFrames }
}
