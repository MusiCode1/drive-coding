/** The two independent choices at a session entry: transport and agent lifetime. */
export type AgentInput =
  | { kind: "new"; cwd: string; cliKind: string; systemPrompt?: string | null }
  | {
      kind: "existing-ws"
      agentId: string
      sessionId: string
      cwd: string
      cliKind: string
      title?: string
      titleManual?: boolean
    }
  | {
      kind: "existing-http"
      agentId: string
      cwd: string
      cliKind: string
      title?: string
      titleManual?: boolean
    }

export type LeaveIntent =
  | {
      kind: "preserve-agent"
      reason: "navigate" | "leave-running" | "attach-failed-existing" | "reconnect-preserve"
    }
  | {
      kind: "terminate-agent"
      reason: "detach" | "delete" | "replace" | "attach-failed-new" | "load-failed"
    }

export interface Connection {
  open(agent: AgentInput): Promise<void>
  close(intent: LeaveIntent): Promise<void>
}
