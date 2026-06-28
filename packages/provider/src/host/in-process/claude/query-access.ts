/**
 * query-access.ts — isolated accessor for the live query object inside ClaudeAcpAgent.
 *
 * ⚠️ צימוד-רך ל-internal לא-מתועד: ClaudeAcpAgent.sessions ציבורי ב-runtime (acp-agent.js:297),
 *    כל רשומה מחזיקה query חי. נקודת-שבירה יחידה אם claude-agent-acp ישנה את sessions.
 *    מכוסה ע"י live test. גרסה נעולה ממילא.
 *
 * Two-SDK containment: ה-interface המקומי מטפס רק את המתודה שאנו קוראים —
 * אין ייבוא טיפוס query מה-SDK.
 */

import type { ClaudeAcpAgent } from "@agentclientprotocol/claude-agent-acp"

/**
 * Local interface that captures only what we need from the session record's query.
 * We do NOT import the SDK's Query type — only the method we call.
 */
interface SessionRecord {
  query: {
    setMaxThinkingTokens(n: number | null, display?: "summarized" | "omitted" | null): Promise<void>
  }
}

/**
 * Returns the live query object for a session.
 * This is the ONLY place in the codebase that accesses .sessions[id].
 *
 * @param agent - the ClaudeAcpAgent instance (must already be initialized)
 * @param sessionId - the session ID whose query to retrieve
 * @throws Error if no live query exists for the given sessionId
 */
export function getQuery(agent: ClaudeAcpAgent, sessionId: string): SessionRecord["query"] {
  const sessions = (agent as unknown as { sessions: Record<string, SessionRecord> }).sessions
  const rec = sessions?.[sessionId]
  if (!rec?.query) throw new Error(`getQuery: no live query for session ${sessionId}`)
  return rec.query
}
