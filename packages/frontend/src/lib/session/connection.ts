import type { ManualTitleInput } from "$lib/view-models/agent-session-manual-title"

/** The two independent choices at a session entry: transport and agent lifetime. */
export type AgentInput =
  | { kind: "new"; cwd: string; cliKind: string; systemPrompt?: string | null }
  | ({
      kind: "existing-ws"
      agentId: string
      sessionId: string
      cwd: string
      cliKind: string
    } & ManualTitleInput)
  | ({
      kind: "existing-http"
      agentId: string
      cwd: string
      cliKind: string
    } & ManualTitleInput)

export interface Connection {
  open(agent: AgentInput): Promise<void>
}
