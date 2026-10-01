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
  appendNestedTool: (parentId: string, child: ToolBubble) => boolean
  updateNestedTool: (
    parentId: string,
    childId: string,
    update: (child: ToolBubble) => ToolBubble,
  ) => void
  getParent: (id: string) => string | undefined
  registerParent: (id: string, parentId: string) => void
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

  deps.appendNestedTool(parentToolUseId, childBubble)
  deps.registerParent(update.toolCallId, parentToolUseId)
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
  const parentToolUseId = deps.getParent(update.toolCallId)
  if (parentToolUseId === undefined) return
  deps.updateNestedTool(parentToolUseId, update.toolCallId, (oldChild) => {
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
    return { ...oldChild, toolCall: newToolCall }
  })
}
