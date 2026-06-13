// ─── canonical Provider types — חוזה v1.2 ─────────────────────────────────
// מקור-האמת: provider-abstraction/docs/design/canonical-contract-proposal.md §3-5 + decision 9
// אין תלות ב-arktype — TS interfaces/unions טהורים.
// adapters (ACP, ClaudeCode) חיים ב-P1b/P1c.

export type ToolKind = "read" | "edit" | "execute" | "search" | "fetch" | "think" | "other"

export interface ToolCallLocation {
  path: string
  line?: number // decision 9 — best-effort, לא מחייב
}

export interface PermissionOption {
  optionId: string
  label: string
  kind: string
}

export type ToolContent =
  | { kind: "text"; text: string }
  | { kind: "diff"; path: string; oldText?: string; newText: string }
  | { kind: "terminal"; terminalId: string }

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  [k: string]: unknown
}

export interface PlanEntry {
  id?: string
  title?: string
  status?: string
}

export type ProviderEvent =
  | { type: "session.ready"; sessionId: string; capabilities: ProviderCapabilities }
  | { type: "message.delta"; role: "assistant"; text: string }
  | { type: "thinking.delta"; text: string }
  | {
      type: "tool_call"
      id: string
      name: string
      input: unknown
      kind: ToolKind
      status: "pending" | "in_progress" | "completed" | "failed"
      locations?: ToolCallLocation[] // v1.2 / decision 9
      content?: ToolContent[]
    }
  | {
      type: "permission.request"
      toolCallId: string
      toolName: string
      input: unknown
      options: PermissionOption[]
    }
  | { type: "task.update"; taskId: string; status: string; summary?: string }
  | { type: "plan.update"; entries: PlanEntry[] }
  | { type: "turn.end"; turnId: string; stopReason: string; isError: boolean }
  | { type: "turn.cancelled"; turnId: string }
  | { type: "status"; status: string }
  | { type: "usage"; usage: Usage }
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string }
  | { type: "error"; error: { code?: number; message: string } }
  | { type: "raw"; provider: string; frame: unknown }

export interface ProviderCapabilities {
  resume: boolean
  list: boolean
  delete: boolean
  close: boolean
  permissions: boolean
  images: boolean
  tools: boolean
  diff: boolean
  revert: boolean
  fs: boolean
  terminal: boolean
  mcpExternal: boolean
  mcpEmbedded: boolean
  extensions?: Record<string, Record<string, unknown>> // decision 8
}

export interface ConsumerCapabilities {
  fs: boolean
  terminal: boolean
  permissions: boolean
  hostTools?: unknown[]
}

export type PromptContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }

export type PromptContent = string | PromptContentPart[]

export interface PromptAck {
  turnId: string
  status: "running" | "queued"
}

export interface ProviderSession {
  readonly providerId: string
  readonly sessionId: string
  readonly capabilities: ProviderCapabilities
  start(consumer: ConsumerCapabilities): Promise<void>
  sendPrompt(content: PromptContent): Promise<PromptAck>
  cancel(turnId?: string): Promise<void>
  stop(): Promise<void>
  onEvent(handler: (e: ProviderEvent) => void): () => void
  // tier 2 — capability-gated (אופציונלי; נוכח רק כשמוצהר ב-capabilities)
  listSessions?(): Promise<unknown[]>
  resumeSession?(id: string): Promise<void>
  deleteSession?(id: string): Promise<void>
  respondToPermission?(toolCallId: string, optionId: string): Promise<void>
  sendRaw?(request: unknown): Promise<unknown>
}
