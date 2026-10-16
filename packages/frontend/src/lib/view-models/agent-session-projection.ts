import type {
  AvailableCommand,
  SessionConfigOption,
  SessionModeState,
  UsageUpdate,
} from "@agentclientprotocol/sdk"
import { type PlanStore, reducePlan } from "@drive-coding/core/acp/plan"
import type { SessionState } from "@drive-coding/core/session"
import type { FrameAction } from "$lib/session/frame-router"
import type { ProjectionSink } from "$lib/session/session-view-delivery"
import type { FrameData, ToolContext } from "$lib/session/session-view-projection"
import {
  appendAgentPlaceholder,
  appendUserImage,
  appendUserPlaceholder,
} from "./agent-session-bubble-append"
import { type HistoryMark, historyMarkFromReset } from "./history-mark"
import {
  handleSubagentToolCall,
  handleSubagentToolCallUpdate,
  type SubagentToolNestingDeps,
} from "./subagent-tool-nesting"
import type { TranscriptScope } from "./transcript-scope.svelte"

type ProjectionUi = {
  modes: SessionModeState | null
  configOptions: SessionConfigOption[]
  availableCommands: AvailableCommand[]
  planStore: PlanStore
  contextUsage: UsageUpdate | null
  titleManual: boolean
  sessionTitle: string
}
export type AgentSessionProjectionDeps = {
  ui: ProjectionUi
  transcript: TranscriptScope
  parents(): Map<string, string>
  turnEnded(): boolean
  setTurnState: SubagentToolNestingDeps["setTurnState"]
  scheduleIdle(): void
  onExtNotification(method: string, params: Record<string, unknown>): void
  pushTitle(title: string): void
  setSessionState(state: SessionState): void
  setHistory(mark: HistoryMark): void
  beforeUpdate(update: unknown): void
  endBatch(state: SessionState): void
  current(): boolean
  onHostRecreated?(): void
}

export function createAgentSessionProjection(d: AgentSessionProjectionDeps): ProjectionSink {
  let attachWindow = true
  return {
    beforeUpdate: (update) => {
      if (d.current()) d.beforeUpdate(update)
    },
    toolContext: (update, actions) => readToolContext(d, update, actions),
    applyFrame(frame, publish) {
      if (!d.current()) return
      if (frame.reset) {
        if (frame.boundary === "host-recreated") d.onHostRecreated?.()
        if (!d.current()) return
        publish()
        d.transcript.applyPatches(frame.patches, frame.resetOrigin)
        d.setSessionState(frame.state)
        if (
          (attachWindow || frame.boundary === "host-recreated") &&
          frame.patches.some((p) => p.op === "reset")
        ) {
          attachWindow = false
          d.setHistory(historyMarkFromReset(frame.state.messages))
        }
        return
      }
      applyFrame(d, frame, publish)
    },
    endBatch: (state) => {
      if (d.current()) d.endBatch(state)
    },
  }
}

function readToolContext(
  d: AgentSessionProjectionDeps,
  raw: unknown,
  actions: FrameAction[],
): ToolContext {
  const tool = actions.find((a) => a.kind === "tool-call" || a.kind === "tool-update")
  const update = raw as { toolCallId?: string }
  const id = update?.toolCallId
  const mappedParent = id === undefined ? undefined : d.parents().get(id)
  const parent = tool && "parentToolUseId" in tool ? tool.parentToolUseId : undefined
  return {
    mappedParent,
    mappedChildExists:
      mappedParent !== undefined &&
      id !== undefined &&
      d.transcript.hasNestedTool(mappedParent, id),
    parentExists: parent !== undefined && d.transcript.hasTool(parent),
    childAlreadyTopLevel: id !== undefined && d.transcript.hasTool(id),
  }
}

function applyFrame(d: AgentSessionProjectionDeps, frame: FrameData, publish: () => void): void {
  let projected = false
  const core = () => {
    publish()
    projected = true
    d.setSessionState(frame.state)
    d.transcript.applyPatches(frame.patches)
  }
  const applyToolCall = (update: Record<string, unknown>) => {
    core()
    if (typeof update.toolCallId === "string")
      d.transcript.flushPendingSubagentEvents(update.toolCallId)
    d.setTurnState("calling-tool")
    if (d.turnEnded()) d.scheduleIdle()
  }
  const nesting: SubagentToolNestingDeps = {
    hasTool: (id) => d.transcript.hasTool(id),
    hasNestedTool: (parent, child) => d.transcript.hasNestedTool(parent, child),
    appendNestedTool: (parent, child) => d.transcript.appendNestedTool(parent, child),
    updateNestedTool: (parent, child, patch) => d.transcript.updateNestedTool(parent, child, patch),
    parents: d.parents,
    turnEnded: d.turnEnded,
    applyToolCall,
    setTurnState: d.setTurnState,
    scheduleIdle: d.scheduleIdle,
  }
  for (const action of frame.actions) {
    const update = frame.rawUpdate as unknown as Record<string, unknown> & {
      toolCallId?: string
    }
    const content = ("content" in action ? action.content : undefined) as {
      mimeType?: string
      data?: string
      name?: string
      uri?: string
    }
    // Adopt the optimistic ID for every user content kind before append/reduce.
    if (
      action.kind === "user-text" ||
      action.kind === "user-image" ||
      action.kind === "user-link" ||
      action.kind === "user-audio" ||
      action.kind === "user-placeholder"
    ) {
      d.transcript.adoptUserMessageId(action.messageId)
    }
    switch (action.kind) {
      case "observed":
        break
      case "extension":
        d.onExtNotification(action.method, action.params as Record<string, unknown>)
        break
      case "tool-call":
        if (action.parentToolUseId !== undefined) {
          handleSubagentToolCall(nesting, update, action.parentToolUseId)
        } else {
          applyToolCall(update)
        }
        break
      // The existing parent map wins over metadata; HTTP may need metadata fallback.
      case "tool-update":
        if (update.toolCallId !== undefined && d.parents().has(update.toolCallId)) {
          handleSubagentToolCallUpdate(nesting, update)
        } else {
          const parentToolUseId = action.parentToolUseId
          const parentBubbleExists =
            parentToolUseId !== undefined &&
            d.transcript.bubbles.some(
              (b) => b.kind === "tool" && b.toolCall.toolCallId === parentToolUseId,
            )
          const childAlreadyTopLevel =
            update.toolCallId !== undefined &&
            d.transcript.bubbles.some(
              (b) => b.kind === "tool" && b.toolCall.toolCallId === update.toolCallId,
            )
          if (parentToolUseId !== undefined && parentBubbleExists && !childAlreadyTopLevel) {
            handleSubagentToolCall(nesting, update, parentToolUseId)
          } else {
            if (update.status === "pending" || update.status === "in_progress") {
              d.setTurnState("calling-tool")
              if (d.turnEnded()) d.scheduleIdle()
            }
            core()
          }
        }
        break
      case "mode": {
        const modeId = update.currentModeId
        if (typeof modeId === "string")
          d.ui.modes = { availableModes: d.ui.modes?.availableModes ?? [], currentModeId: modeId }
        break
      }
      case "config":
        if (Array.isArray(update.configOptions))
          d.ui.configOptions = update.configOptions as SessionConfigOption[]
        break
      case "commands":
        d.ui.availableCommands = Array.isArray(update.availableCommands)
          ? (update.availableCommands as AvailableCommand[])
          : []
        break
      case "plan":
        d.ui.planStore = reducePlan(d.ui.planStore, update)
        break
      case "usage": {
        const u = update as unknown as UsageUpdate
        d.ui.contextUsage = {
          used: u.used,
          size: u.size,
          cost: u.cost ?? d.ui.contextUsage?.cost,
        }
        break
      }
      case "title": {
        if (d.ui.titleManual) break
        const title = update.title as string | null | undefined
        if (title === null) d.ui.sessionTitle = ""
        else if (typeof title === "string") {
          d.ui.sessionTitle = title
          d.pushTitle(d.ui.sessionTitle)
        }
        break
      }
      case "user-text": {
        core()
        break
      }
      case "user-image":
        appendUserImage(d.transcript, action.messageId, {
          mimeType: content.mimeType as string,
          data: content.data as string,
        })
        break
      case "user-link": {
        const label = content.name ?? content.uri
        appendUserPlaceholder(d.transcript, action.messageId, {
          kind: "resource_link",
          label: label as string | undefined,
          uri: content.uri as string | undefined,
        })
        break
      }
      case "user-audio":
        appendUserPlaceholder(d.transcript, action.messageId, { kind: "audio" })
        break
      case "user-placeholder":
        appendUserPlaceholder(d.transcript, action.messageId, { kind: "resource" })
        break
      case "agent-text":
        d.setTurnState("responding")
        if (d.turnEnded()) d.scheduleIdle()
        {
          core()
        }
        break
      case "agent-content": {
        d.setTurnState("responding")
        if (d.turnEnded()) d.scheduleIdle()
        // Keep the direct null access after turn-state mutation (legacy parity).
        const agentContent = content as {
          type?: string
          name?: string
          uri?: string
        }
        if (agentContent.type === "resource_link") {
          appendAgentPlaceholder(d.transcript, action.messageId, {
            kind: "resource_link",
            label: (agentContent.name ?? agentContent.uri ?? "") as string,
            uri: agentContent.uri as string | undefined,
          })
        } else {
          appendAgentPlaceholder(d.transcript, action.messageId, {
            kind:
              agentContent.type === "image"
                ? "image"
                : agentContent.type === "audio"
                  ? "audio"
                  : "resource",
          })
        }
        break
      }
      case "thought-text":
        d.setTurnState("thinking")
        if (d.turnEnded()) d.scheduleIdle()
        {
          core()
        }
        break
      case "default": {
        core()
        break
      }
    }
  }
  if (!projected) {
    publish()
    d.setSessionState(frame.state)
  }
}
