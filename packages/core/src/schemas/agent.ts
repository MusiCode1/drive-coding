import { type } from "arktype"

// CLI kinds נתמכים (D6 + D24)
export const CliKind = type("'opencode' | 'claude' | 'gemini' | 'codex'")
export type CliKind = typeof CliKind.infer

// Status state machine
// starting: בתהליך spawn (Slice 3+)
// ready: זמין לקבל prompts
// busy: prompt בעבודה
// crashed: bridge נפל
// closed: כובה ע"י user
export const AgentStatus = type("'starting' | 'ready' | 'busy' | 'crashed' | 'closed'")
export type AgentStatus = typeof AgentStatus.infer

// Internal — backend בלבד
export const Agent = type({
  id: "string.uuid",
  cliKind: CliKind,
  cwd: "string",
  modelOverride: "string | null",
  status: AgentStatus,
  createdAt: "string.date.iso",
  // Bridge details (יתמלאו ב-Slice 3)
  "bridgePort?": "number",
  "acpSessionId?": "string",
})
export type Agent = typeof Agent.infer

// Public — מה שה-frontend מקבל
export const AgentPublic = type({
  id: "string.uuid",
  cliKind: CliKind,
  cwd: "string",
  modelOverride: "string | null",
  status: AgentStatus,
  createdAt: "string.date.iso",
})
export type AgentPublic = typeof AgentPublic.infer

// Input ל-POST /api/agents
export const CreateAgentInput = type({
  cliKind: CliKind,
  cwd: "string >= 1",
  "modelOverride?": "string | null",
})
export type CreateAgentInput = typeof CreateAgentInput.infer

// רשימה
export const AgentList = type({
  agents: AgentPublic.array(),
})
export type AgentList = typeof AgentList.infer

// Helper — Agent → AgentPublic
export function toAgentPublic(agent: Agent): AgentPublic {
  return {
    id: agent.id,
    cliKind: agent.cliKind,
    cwd: agent.cwd,
    modelOverride: agent.modelOverride,
    status: agent.status,
    createdAt: agent.createdAt,
  }
}
