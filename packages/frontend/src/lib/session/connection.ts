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

/** How Connection.close treats agent lifetime vs view/transport resources. */
export type CloseMode = { kind: "preserve-agent" } | { kind: "end-view" } | { kind: "recover" }

export interface Connection {
  open(agent: AgentInput): Promise<void>
  reconnect(): Promise<void>
  cancelReconnect(): void
  /** Synchronous entry; closes captured resources fire-and-forget. Idempotent per bundle. */
  close(mode: CloseMode): void
  /** Releases ownership using agentId+connectionId captured at adoption (not live VM refs). */
  deleteAgentOnce(agentId: string): void
  release(): void
  /** Updates captured release agent after warm/cold host swap. */
  updateReleaseAgent?(agentId: string): void
}
