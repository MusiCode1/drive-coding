import { type Patch, reduce, type SessionState } from "@drive-coding/core/session"
import type { FrameAction } from "./frame-router"

export type ToolContext = {
  mappedParent?: string
  mappedChildExists: boolean
  parentExists: boolean
  childAlreadyTopLevel: boolean
}
export const EMPTY_TOOL_CONTEXT: ToolContext = {
  mappedChildExists: false,
  parentExists: false,
  childAlreadyTopLevel: false,
}
export type FrameData = {
  state: SessionState
  patches: Patch[]
  rawUpdate?: unknown
  actions: FrameAction[]
  toolDisposition: "none" | "top-create" | "top-update" | "nested-create" | "nested-update"
  reset: boolean
  readonly resetOrigin?: "same-session-reconnect"
}

// Reads data only. The action and raw payload references remain unchanged.
export function projectSessionUpdate(
  state: SessionState,
  rawUpdate: unknown,
  actions: FrameAction[],
  context: ToolContext,
): FrameData {
  let toolDisposition: FrameData["toolDisposition"] = "none"
  let input: unknown = rawUpdate
  let skip = false
  const tool = actions.find((a) => a.kind === "tool-call" || a.kind === "tool-update")
  if (tool?.kind === "tool-call" || tool?.kind === "tool-update") {
    const update = rawUpdate as { toolCallId?: string }
    if (tool.kind === "tool-call") {
      skip =
        tool.parentToolUseId !== undefined &&
        (update.toolCallId === undefined || context.parentExists)
      toolDisposition = skip ? "nested-create" : "top-create"
    } else if (context.mappedParent !== undefined) {
      skip = true
      toolDisposition = "nested-update"
    } else if (
      tool.parentToolUseId !== undefined &&
      context.parentExists &&
      !context.childAlreadyTopLevel
    ) {
      skip = true
      toolDisposition = "nested-create"
    } else toolDisposition = "top-update"
    if (toolDisposition === "top-create") {
      input = { ...(rawUpdate as Record<string, unknown>), sessionUpdate: "tool_call" }
    }
  }
  const result = skip ? { state, patches: [] } : reduce(state, input)
  return {
    ...result,
    rawUpdate,
    actions,
    toolDisposition,
    reset: result.patches.some((patch) => patch.op === "reset"),
  }
}

export function projectSessionSnapshot(
  state: SessionState,
  hydrate: boolean,
  resetOrigin?: "same-session-reconnect",
): FrameData {
  const patches: Patch[] = hydrate
    ? [
        {
          version: state.version,
          op: "reset",
          messages: state.messages,
          nextMessageSeq: state.nextMessageSeq,
          nextSegmentSeq: state.nextSegmentSeq,
        },
      ]
    : []
  return { state, patches, actions: [], toolDisposition: "none", reset: true, resetOrigin }
}
