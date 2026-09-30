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

export interface Connection {
  open(agent: AgentInput): Promise<void>
}
