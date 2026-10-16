export type FrameAction =
  | { kind: "observed"; update: unknown }
  | { kind: "extension"; method: string; params: object }
  | { kind: "default"; update: unknown }
  | { kind: "tool-call" | "tool-update"; update: unknown; parentToolUseId?: string }
  | { kind: "mode" | "config" | "commands" | "plan" | "usage" | "title"; update: unknown }
  | {
      kind:
        | "user-text"
        | "user-image"
        | "user-link"
        | "user-audio"
        | "user-placeholder"
        | "agent-text"
        | "agent-content"
        | "thought-text"
      update: unknown
      messageId: string | null
      content?: unknown
    }

function parentId(update: unknown): string | undefined {
  if (typeof update !== "object" || update === null) return undefined
  const meta = (update as { _meta?: unknown })._meta
  if (typeof meta !== "object" || meta === null) return undefined
  const claudeCode = (meta as { claudeCode?: unknown }).claudeCode
  if (typeof claudeCode !== "object" || claudeCode === null) return undefined
  const id = (claudeCode as { parentToolUseId?: unknown }).parentToolUseId
  return typeof id === "string" ? id : undefined
}

const simpleKinds: Record<string, FrameAction["kind"]> = {
  tool_call: "tool-call",
  tool_call_update: "tool-update",
  current_mode_update: "mode",
  config_option_update: "config",
  available_commands_update: "commands",
  plan: "plan",
  plan_update: "plan",
  plan_removed: "plan",
  usage_update: "usage",
  session_info_update: "title",
}

export function classifySessionUpdate(frame: { update: unknown }): FrameAction[] {
  const input = frame.update
  const observed: FrameAction = { kind: "observed", update: input }
  // Deliberate direct access: nullish update historically throws after observer/activity.
  const name = (input as { sessionUpdate?: unknown }).sessionUpdate
  if (name === "_drive/ext_notification") {
    const ext = input as { method?: unknown; params?: unknown }
    return typeof ext.method === "string" && typeof ext.params === "object" && ext.params !== null
      ? [observed, { kind: "extension", method: ext.method, params: ext.params }]
      : [observed]
  }
  if (name === "_drive/reset") return [observed]

  if (typeof name === "string" && Object.hasOwn(simpleKinds, name)) {
    const kind = simpleKinds[name]
    const action = { kind, update: input } as FrameAction
    if (kind === "tool-call" || kind === "tool-update") {
      return [observed, { kind, update: input, parentToolUseId: parentId(input) }]
    }
    return [observed, action]
  }

  const update = input as { content?: unknown; messageId?: unknown }
  const content = update.content
  const messageId = (update.messageId ?? null) as string | null
  const contentType = (content as { type?: unknown } | null | undefined)?.type
  if (name === "user_message_chunk") {
    const kind =
      contentType === "text"
        ? "user-text"
        : contentType === "image" &&
            (content as { data?: unknown }).data !== undefined &&
            (content as { mimeType?: unknown }).mimeType !== undefined
          ? "user-image"
          : contentType === "resource_link"
            ? "user-link"
            : contentType === "audio"
              ? "user-audio"
              : "user-placeholder"
    return [observed, { kind, update: input, messageId, content }]
  }
  if (name === "agent_message_chunk") {
    if (contentType === "text") {
      return ((content as { text?: unknown }).text ?? "")
        ? [observed, { kind: "agent-text", update: input, messageId, content }]
        : [observed]
    }
    return content !== undefined
      ? [observed, { kind: "agent-content", update: input, messageId, content }]
      : [observed]
  }
  if (name === "agent_thought_chunk") {
    const text = (content as { text?: unknown } | null | undefined)?.text ?? ""
    return contentType === "text" && text
      ? [observed, { kind: "thought-text", update: input, messageId, content }]
      : [observed]
  }
  return [observed, { kind: "default", update: input }]
}
