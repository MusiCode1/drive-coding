import { type } from "arktype"

// סוגי CLI נתמכים (D6 + D24)
export const CliKind = type("'opencode' | 'claude' | 'gemini' | 'codex'")
export type CliKind = typeof CliKind.infer

// מכונת מצבים (State machine) של סטטוס
// starting: בתהליך spawn (Slice 3+)
// ready: זמין לקבל prompts
// busy: prompt בעבודה
// crashed: bridge נפל
// closed: כובה ע"י המשתמש
export const AgentStatus = type("'starting' | 'ready' | 'busy' | 'crashed' | 'closed'")
export type AgentStatus = typeof AgentStatus.infer

// פנימי — מיועד ל-backend בלבד
export const Agent = type({
  id: "string.uuid",
  cliKind: CliKind,
  cwd: "string",
  modelOverride: "string | null",
  status: AgentStatus,
  createdAt: "string.date.iso",
  // פרטי Bridge (יתמלאו ב-Slice 3)
  "bridgePort?": "number",
  "acpSessionId?": "string",
  // סיבת שגיאת ספק (Slice 5.6 — D47)
  "crashReason?": "string",
})
export type Agent = typeof Agent.infer

// פומבי — מה שה-frontend מקבל
export const AgentPublic = type({
  id: "string.uuid",
  cliKind: CliKind,
  cwd: "string",
  modelOverride: "string | null",
  status: AgentStatus,
  createdAt: "string.date.iso",
  // מאוכלס כאשר status='crashed' ושגיאת הספק חולצה (Slice 5.6)
  "crashReason?": "string",
  // Slice 10: נוכח ברגע שה-FE השלים את לחיצת היד של ה-ACP וקרא ל-/session-attached.
  // ה-FE משתמש בזה בעת רענון כדי לקרוא ל-loadSession() במקום newSession() — מונע
  // התנגשות 409 ומשחזר את היסטוריית ה-session.
  "acpSessionId?": "string",
})
export type AgentPublic = typeof AgentPublic.infer

// קלט ל-POST /api/agents
export const CreateAgentInput = type({
  cliKind: CliKind,
  cwd: "string >= 1",
  "modelOverride?": "string | null",
  // Slice 8a: טעינת session ACP קיים דרך session/load במקום newSession
  "existingSessionId?": "string",
})
export type CreateAgentInput = typeof CreateAgentInput.infer

// רשימה
export const AgentList = type({
  agents: AgentPublic.array(),
})
export type AgentList = typeof AgentList.infer

// פונקציית עזר — המרה מ-Agent ל-AgentPublic
export function toAgentPublic(agent: Agent): AgentPublic {
  const pub: AgentPublic = {
    id: agent.id,
    cliKind: agent.cliKind,
    cwd: agent.cwd,
    modelOverride: agent.modelOverride,
    status: agent.status,
    createdAt: agent.createdAt,
  }
  if (agent.crashReason !== undefined) {
    pub.crashReason = agent.crashReason
  }
  if (agent.acpSessionId !== undefined) {
    pub.acpSessionId = agent.acpSessionId
  }
  return pub
}
