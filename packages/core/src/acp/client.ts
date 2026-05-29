/**
 * client.ts — createAcpClient: ACP client אגנוסטי לתעבורה.
 *
 * זרימה (מוכנות מבוססת-נתונים):
 * 1. הקורא מעביר AcpTransport פתוח. התעבורה חייבת להיות מוכנה לשליחה/קבלה
 *    לפני שקוראים לפונקציה הזו (למשל WS כבר במצב OPEN).
 * 2. בניית pipeline של streams: transport.readable/writable → ndJsonStream →
 *    ClientSideConnection.
 * 3. initialize() עם fs caps = false, עטוף ב-Promise.race עם timeout של 10 שניות.
 *    המוכנות מוכחת על-ידי תגובת ה-ACP עצמה — אין frame handshake סינתטי.
 *    אם אין תגובה בתוך INIT_TIMEOUT_MS → סוגר transport, זורק timeout.
 *
 * auth_required: אם initialize זורקת עם data.code === "auth_required",
 * זורק מחדש עם kind = "auth_required" כדי שה-UI יציג הודעת "<cli> auth login".
 *
 * החלטות מחזור חיים מחוץ למודול זה:
 *   - Heartbeat / NAT keepalive — עניין ספציפי לתעבורה. תעבורת WS
 *     מטפלת בזה פנימית (ראה WsAcpTransport). Stdio + mock אינם זקוקים לזה.
 *   - onClose subscription — הקורא רושם ישירות על התעבורה
 *     לפני שמעביר אותה לכאן.
 *   - Auto-reconnect — לא מטופל באף שכבה. ה-UI מציג פרומפט "רענן".
 */
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { createClientImpl } from "./client-impl.js"
import type { AcpTransport } from "./transport.js"

const DEFAULT_INIT_TIMEOUT_MS = 10_000

export type AcpClientOptions = {
  /** דריסת timeout האתחול. ברירת מחדל: 10 שניות. בבדיקות מעבירים ערך קטן. */
  initTimeoutMs?: number
}

export type AcpClient = {
  conn: ClientSideConnection
  capabilities: Awaited<ReturnType<ClientSideConnection["initialize"]>>["agentCapabilities"]
  newSession(opts: { cwd: string }): ReturnType<ClientSideConnection["newSession"]>
  loadSession(opts: {
    cwd: string
    sessionId: string
  }): ReturnType<ClientSideConnection["loadSession"]>
  listSessions(): ReturnType<ClientSideConnection["listSessions"]>
  prompt(sessionId: string, text: string): ReturnType<ClientSideConnection["prompt"]>
  cancel(sessionId: string): ReturnType<ClientSideConnection["cancel"]>
  close(): void
}

export async function createAcpClient(
  transport: AcpTransport,
  onUpdate: (n: SessionNotification) => void,
  options: AcpClientOptions = {},
): Promise<AcpClient> {
  const initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS

  // בניית streams + connection — ה-SDK מתחיל לקרוא מהצינור מיד.
  const stream = ndJsonStream(transport.writable, transport.readable)
  const client = createClientImpl({ onUpdate })
  const conn = new ClientSideConnection((_agent) => client, stream)

  // initialize עם fs caps = false — עטוף ב-Promise.race עם timeout.
  // קבלת תגובת ACP תקינה היא עצמה אות המוכנות; אין צורך ב-frame handshake
  // סינתטי. אם התעבורה או הסוכן אינם מגיבים, ה-timeout נורה עם שגיאה ברורה.
  let initTimer: ReturnType<typeof setTimeout> | undefined
  let initResult: Awaited<ReturnType<typeof conn.initialize>>
  const initPromise = conn.initialize({
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
    },
    clientInfo: { name: "drive-coding", version: "0.2.0" },
  })
  // מסמנים את initPromise כמטופל כדי לדכא unhandled-rejection אם ה-race
  // מסתיים דרך timeout. הדחייה האמיתית (אם קיימת) עדיין נצפית
  // על-ידי Promise.race למטה.
  initPromise.catch(() => {})
  try {
    initResult = await Promise.race([
      initPromise,
      new Promise<never>((_, reject) => {
        initTimer = setTimeout(() => {
          reject(
            new Error(
              `ACP initialize timeout after ${initTimeoutMs}ms — no response from agent (transport or child unresponsive)`,
            ),
          )
        }, initTimeoutMs)
      }),
    ])
    if (initTimer !== undefined) clearTimeout(initTimer)
  } catch (e) {
    if (initTimer !== undefined) clearTimeout(initTimer)
    // שגיאת auth_required — זורק מחדש עם kind ל-UI
    const err = e as { code?: number; data?: { code?: string }; message?: string }
    if (err?.data?.code === "auth_required") {
      const authErr = new Error(
        `ACP agent requires authentication: ${err.message ?? "auth_required"}. ` +
          `Run in shell: '<cli> auth login'.`,
      )
      ;(authErr as Error & { kind?: string }).kind = "auth_required"
      transport.close()
      throw authErr
    }
    transport.close()
    throw e
  }

  return {
    conn,
    capabilities: initResult.agentCapabilities,

    /** יוצר session ACP חדש */
    async newSession(opts: { cwd: string }) {
      return conn.newSession({ cwd: opts.cwd, mcpServers: [] })
    },

    /**
     * טוען session ACP קיים לפי sessionId.
     * עשוי לזרוק -32601 אם ה-CLI אינו תומך ביכולת loadSession.
     */
    async loadSession(opts: { cwd: string; sessionId: string }) {
      return conn.loadSession({ sessionId: opts.sessionId, cwd: opts.cwd, mcpServers: [] })
    },

    /**
     * מפרט sessions מהסוכן.
     * עשוי לזרוק -32601 אם ה-CLI אינו תומך ביכולת listSessions.
     */
    async listSessions() {
      return conn.listSessions({})
    },

    /** שולח פרומפט טקסטואלי ב-session הנתון */
    async prompt(sessionId: string, text: string) {
      return conn.prompt({ sessionId, prompt: [{ type: "text", text }] })
    },

    /** מבטל פעולה פעילה ב-session הנתון */
    async cancel(sessionId: string) {
      return conn.cancel({ sessionId })
    },

    /** סוגר את התעבורה הבסיסית */
    close() {
      transport.close()
    },
  }
}
