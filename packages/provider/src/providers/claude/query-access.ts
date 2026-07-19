/**
 * query-access.ts — isolated accessor for the live query object inside ClaudeAcpAgent.
 *
 * ⚠️ צימוד-רך ל-internal לא-מתועד: ClaudeAcpAgent.sessions ציבורי ב-runtime (acp-agent.js:297),
 *    כל רשומה מחזיקה query חי. נקודת-שבירה יחידה אם claude-agent-acp ישנה את sessions.
 *    מכוסה ע"י live test. גרסה נעולה ממילא.
 *
 * Two-SDK containment: ה-interface המקומי מטפס רק את המתודות שאנו קוראים —
 * אין ייבוא טיפוס Query מה-SDK. `SDKControlGetUsageResponse` הוא רק ה-response
 * shape (לא ה-Query interface עצמו) — משמש את quota.ts לנרמול (slice session-budget-meter).
 */

import type { ClaudeAcpAgent } from "@agentclientprotocol/claude-agent-acp"
import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk"

/**
 * Local interface that captures only what we need from the session record's query.
 * We do NOT import the SDK's Query type — only the methods we call.
 */
interface SessionRecord {
  query: {
    setMaxThinkingTokens(n: number | null, display?: "summarized" | "omitted" | null): Promise<void>
    // slice session-budget-meter Commit 3 — experimental, per @anthropic-ai/claude-agent-sdk 0.3.207.
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(): Promise<SDKControlGetUsageResponse>
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
