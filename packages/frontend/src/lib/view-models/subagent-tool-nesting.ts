import { mapLocations, mapToolContent } from "$lib/session/map-tool-content"
import type { ToolBubble, ToolCall } from "$lib/types/bubble"
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
  hasTool: (parentId: string) => boolean
  hasNestedTool: (parentId: string, childId: string) => boolean
  appendNestedTool: (parentId: string, child: ToolBubble) => boolean
  updateNestedTool: (parentId: string, childId: string, patch: Partial<ToolCall>) => void
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
  if (!deps.hasTool(parentToolUseId)) {
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

  if (!deps.appendNestedTool(parentToolUseId, childBubble)) {
    deps.applyToolCall(update as Record<string, unknown>)
    return
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
  if (!deps.hasNestedTool(parentToolUseId, update.toolCallId)) return
  const patch: Partial<ToolCall> = {
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
  deps.updateNestedTool(parentToolUseId, update.toolCallId, patch)
}
