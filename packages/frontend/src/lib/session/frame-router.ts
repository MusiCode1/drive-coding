/** Pure classification of one raw ACP or HTTP session update. No VM state is read here. */
export type FrameInput = { update: unknown }
type RawPatch = { update: unknown }
type MessagePatch = RawPatch & { messageId: string | null }
export type FramePatch =
  | ({ kind: "observed" } & RawPatch)
  | { kind: "ext-notification"; method: string; params: Record<string, unknown> }
  | ({
      kind:
        | "tool-call"
        | "tool-call-update"
        | "mode"
        | "config"
        | "commands"
        | "plan"
        | "usage"
        | "title"
        | "default"
    } & RawPatch)
  | ({
      kind:
        | "user-text"
        | "user-image"
        | "user-placeholder"
        | "agent-text"
        | "agent-placeholder"
        | "thought-text"
    } & MessagePatch)

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function toPatches({ update }: FrameInput): FramePatch[] {
  const observed: FramePatch = { kind: "observed", update }
  if (!record(update)) return [observed, { kind: "default", update }]
  const name = update.sessionUpdate
  if (name === "_drive/ext_notification") {
    return typeof update.method === "string" && record(update.params)
      ? [observed, { kind: "ext-notification", method: update.method, params: update.params }]
      : [observed]
  }
  if (name === "_drive/reset") return [observed]
  const simpleKinds = {
    tool_call: "tool-call",
    tool_call_update: "tool-call-update",
    current_mode_update: "mode",
    config_option_update: "config",
    available_commands_update: "commands",
    plan: "plan",
    plan_update: "plan",
    plan_removed: "plan",
    usage_update: "usage",
    session_info_update: "title",
  } as const
  if (typeof name === "string" && name in simpleKinds) {
    return [observed, { kind: simpleKinds[name as keyof typeof simpleKinds], update }]
  }
  const messageId = typeof update.messageId === "string" ? update.messageId : null
  const content = record(update.content) ? update.content : undefined
  if (name === "user_message_chunk") {
    const kind =
      content?.type === "text"
        ? "user-text"
        : content?.type === "image" &&
            typeof content.data === "string" &&
            typeof content.mimeType === "string"
          ? "user-image"
          : "user-placeholder"
    return [observed, { kind, update, messageId }]
  }
  if (name === "agent_message_chunk") {
    if (content?.type === "text") {
      return typeof content.text === "string" && content.text.length > 0
        ? [observed, { kind: "agent-text", update, messageId }]
        : [observed]
    }
    return content ? [observed, { kind: "agent-placeholder", update, messageId }] : [observed]
  }
  if (name === "agent_thought_chunk") {
    return content?.type === "text" && typeof content.text === "string" && content.text.length > 0
      ? [observed, { kind: "thought-text", update, messageId }]
      : [observed]
  }
  return [observed, { kind: "default", update }]
}
