/**
 * sessions.ts — אדפטר עבור קבלת רשימת sessions של ACP.
 *
 * משתמש בסוכן חד-פעמי (spawn → listSessions → delete) כדי שהקורא
 * לא יזדקק לחיבור ACP פעיל.
 *
 * עלות: ~300-700ms (spawn + ACP handshake + listSessions + delete).
 * קרא רק בפעולת משתמש מפורשת — תמיד הצג ספינר תחילה.
 */

import type { CliKind } from "@drive-coding/core"
import { createAcpClient } from "@drive-coding/provider/client"
import { WsAcpTransport } from "@drive-coding/provider/transport/ws"
import { createAgent, deleteAgent } from "$lib/adapters/agents-api"
import { beWsUrl } from "$lib/util/be-url"

export type SessionInfo = {
  sessionId: string
  cwd: string
  title: string // מחרוזת ריקה אם ה-CLI לא מחזיר כותרת
  updatedAt: string // חותמת זמן ISO (או מחרוזת ריקה אם חסר)
}

/**
 * מחזיר רשימת sessions עבור קומבינציה של (cwd, cliKind) על ידי יצירת סוכן חד-פעמי,
 * קריאה ל-ACP listSessions, ואז מחיקת הסוכן.
 *
 * מחזיר [] אם:
 *   - ה-CLI לא תומך ב-session/list (שגיאה -32601, למשל Gemini)
 *   - לא קיימים sessions קודמים עבור ה-cwd הזה
 *
 * זורק שגיאה ב:
 *   - כישלון יצירת סוכן (cwd לא קיים, קובץ בינארי חסר)
 *   - שגיאות רשת
 */
export async function listSessionsForCwd(cwd: string, cliKind: CliKind): Promise<SessionInfo[]> {
  let tempAgentId: string | null = null
  let acp: Awaited<ReturnType<typeof createAcpClient>> | null = null

  try {
    // 1. צור סוכן חד-פעמי
    const { agentId } = await createAgent({ cwd, cliKind })
    tempAgentId = agentId

    // 2. פתח תעבורת WS + לחיצת יד של ACP
    const transport = new WsAcpTransport(beWsUrl(`/ws/agent/${agentId}`))
    await transport.waitForOpen()

    // noop update handler — אכפת לנו רק מתשובת ה-listSessions
    acp = await createAcpClient(transport, () => {})

    // 3. קרא ל-listSessions
    try {
      const res = await acp.listSessions()
      const raw = (res as { sessions?: unknown[] }).sessions ?? []
      return raw.map(normalizeSessionInfo)
    } catch (e) {
      // -32601 = מתודה לא נמצאה (למשל Gemini לא תומך ב-listSessions)
      if ((e as { code?: number }).code === -32601) return []
      throw e
    }
  } finally {
    // תמיד נקה בסוף: קודם סגור WS, ואז מחיקה מסוג fire-and-forget
    try {
      acp?.close()
    } catch {
      // כבר סגור
    }
    if (tempAgentId !== null) {
      // fire-and-forget: השרת (BE) הורג את תהליך הילד במחיקה (DELETE); ה-WS כבר נסגר למעלה
      void deleteAgent(tempAgentId).catch(() => {})
    }
  }
}

/** ממיר נתוני session גולמיים מה-ACP לצורת SessionInfo. ─── slice sessions-inline: ייצוא ל-AgentSession ─── */
export function normalizeSessionInfo(s: unknown): SessionInfo {
  const item = s as Record<string, unknown>
  return {
    sessionId: String(item["sessionId"] ?? ""),
    cwd: String(item["cwd"] ?? ""),
    title: String(item["title"] ?? ""),
    updatedAt: String(item["updatedAt"] ?? ""),
  }
}
