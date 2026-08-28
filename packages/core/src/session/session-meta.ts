/**
 * session-meta.ts — provider-specific session bootstrap _meta (slice http-session-bootstrap).
 *
 * Single source of truth for Claude ACP session options requested at newSession/loadSession.
 * WS (FE AgentSession) and HTTP (BE registry/rpc) both call sessionMetaFor(cliKind).
 */

const CLAUDE_SESSION_META = {
  claudeCode: {
    options: {
      thinking: { type: "adaptive", display: "summarized" },
      forwardSubagentText: true,
    },
    emitRawSDKMessages: [
      { type: "system", subtype: "task_started" },
      { type: "system", subtype: "task_progress" },
      { type: "system", subtype: "task_notification" },
      { type: "system", subtype: "task_updated" },
      { type: "assistant" },
      { type: "user" },
    ],
  },
} as const

export function sessionMetaFor(cliKind: string): Record<string, unknown> | undefined {
  return cliKind === "claude" ? (CLAUDE_SESSION_META as Record<string, unknown>) : undefined
}
