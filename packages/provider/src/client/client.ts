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
import type {
  Client,
  ClientSideConnection as ClientSideConnectionType,
  NewSessionRequest,
  SessionNotification,
  SetSessionConfigOptionResponse,
  SetSessionModeResponse,
} from "@agentclientprotocol/sdk"
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import type { AcpTransport } from "../transport/types.js"
import { createClientImpl } from "./client-impl.js"

/** נגזר מ-SDK — לא shape מותאם; drift אפס. */
type AcpRequestMeta = NewSessionRequest["_meta"]

// ─── slice-image-paste: PromptBlocks + buildPromptParam ───
/** projection טהור מה-SDK — ContentBlock[]; drift אפס. */
type PromptRequest = Parameters<ClientSideConnectionType["prompt"]>[0]
export type PromptBlocks = PromptRequest["prompt"]

/**
 * ממיר content (string או PromptBlocks) לפורמט ה-prompt של conn.prompt.
 * string → [{type:"text",text}]; PromptBlocks → passthrough ישיר.
 * מיוצאת לטובת unit tests (TDD — Commit 4a).
 */
export function buildPromptParam(content: string | PromptBlocks): PromptBlocks {
  if (typeof content === "string") {
    return [{ type: "text", text: content }]
  }
  return content
}

const DEFAULT_INIT_TIMEOUT_MS = 10_000

// סדר-עדיפות לפי המדידה החיה ב-docs/plans/slice-cursor-acp.md §-1:
// grok = cached_token/grok.com, cursor = cursor_login.
// אין xai.api_key בפועל — לא להוסיף methodId שלא נצפה.
const PREFERRED = ["cached_token", "grok.com", "cursor_login"] as const

/** Pick auth method from initialize response — PREFERRED order, then first offered. */
export function resolveAuthMethodId(
  authMethods: ReadonlyArray<{ id: string }> | undefined,
): string | undefined {
  if (!authMethods?.length) return undefined
  const ids = new Set(authMethods.map((m) => m.id))
  return PREFERRED.find((id) => ids.has(id)) ?? authMethods[0]?.id
}

/**
 * מזהה שגיאת auth_required אמיתית (data.code === "auth_required") — בניגוד לכל שגיאה
 * אחרת (כמו -32603 "not implemented" של opencode, שמכריז authMethods בלי ליישם authenticate).
 * משותף ל-catch של initialize וגם authenticate — ר' docs/plans/slice-cursor-acp.md §4 Commit 1
 * (תוקן אחרי calev NO-GO — הגרסה המקורית סגרה transport על כל כישלון authenticate ושברה opencode).
 */
function isAuthRequiredError(e: unknown): e is { data?: { code?: string }; message?: string } {
  const err = e as { data?: { code?: string } }
  return err?.data?.code === "auth_required"
}

export type AcpClientOptions = {
  /** דריסת timeout האתחול. ברירת מחדל: 10 שניות. בבדיקות מעבירים ערך קטן. */
  initTimeoutMs?: number
}

export type AcpClient = {
  conn: ClientSideConnection
  capabilities: Awaited<ReturnType<ClientSideConnection["initialize"]>>["agentCapabilities"]
  newSession(opts: {
    cwd: string
    _meta?: AcpRequestMeta
  }): ReturnType<ClientSideConnection["newSession"]>
  loadSession(opts: {
    cwd: string
    sessionId: string
    _meta?: AcpRequestMeta
  }): ReturnType<ClientSideConnection["loadSession"]>
  listSessions(): ReturnType<ClientSideConnection["listSessions"]>
  // ─── slice session-delete: Commit 0 ───
  /**
   * מוחק session מ-`session/list` (store/persistence) — **לא** הורג את ה-process.
   * זמין רק אם הסוכן מכריז `sessionCapabilities.delete` (raw capabilities, `client.capabilities`).
   */
  deleteSession(sessionId: string): Promise<void>
  // ─── slice-image-paste: Commit 4a — backward-compatible (string עדיין עובד) ───
  prompt(
    sessionId: string,
    content: string | PromptBlocks,
  ): ReturnType<ClientSideConnection["prompt"]>
  cancel(sessionId: string): ReturnType<ClientSideConnection["cancel"]>
  close(): void

  // ─── session config (slice 23) ───
  setSessionConfigOption(opts: {
    sessionId: string
    configId: string
    value: string | boolean
  }): Promise<SetSessionConfigOptionResponse>

  setSessionMode(opts: { sessionId: string; modeId: string }): Promise<SetSessionModeResponse>

  setSessionModel(opts: { sessionId: string; modelId: string }): Promise<void>

  // ─── slice FE-normalization: ext channel ───
  /**
   * שולח ext request ל-`_drive/*` דרך ClientSideConnection.extMethod (acp.d.ts:546).
   * passthrough ישיר — ה-ExtClient facade (adapters) מאמת params לפני קריאה לכאן.
   */
  extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
}

/** נגזר מ-SDK — לא shape מותאם; drift אפס. ר' docs/plans/slice-permission-ui-basic.md §4 Commit 0. */
type PermissionParams = Parameters<Client["requestPermission"]>[0]
type PermissionResponse = Awaited<ReturnType<Client["requestPermission"]>>

export type AcpClientCallbacks = {
  onUpdate: (n: SessionNotification) => void
  /** ─── slice FE-normalization: קבלת ext notifications (כולל _drive/capabilities) ─── */
  onExtNotification?: (method: string, params: Record<string, unknown>) => void
  /**
   * ─── slice-permission-ui-basic: בקשת הרשאה חיה ─── ללא handler → auto-allow (client-impl.ts).
   * דפוס גנרי ניתן-לשכפול — slice B (elicitation) ישכפל אותו ל-onCreateElicitation.
   */
  onRequestPermission?: (params: PermissionParams) => Promise<PermissionResponse>
}

// ─── helper פרטי: בונה את ה-facade המשותף לשני הנתיבים ────────────────────────

/**
 * buildAcpClientFacade — חילוץ ה-return-object ל-helper פרטי משותף.
 * קורא לו גם createAcpClient (cold, אחרי initialize) וגם createAttachedAcpClient
 * (warm reattach, בלי initialize). לוגיקת ה-facade עצמה לא השתנתה — extraction בלבד.
 */
function buildAcpClientFacade(
  conn: ClientSideConnection,
  transport: AcpTransport,
  capabilities: AcpClient["capabilities"],
): AcpClient {
  return {
    conn,
    capabilities,

    /** יוצר session ACP חדש */
    async newSession(opts: { cwd: string; _meta?: AcpRequestMeta }) {
      return conn.newSession({
        cwd: opts.cwd,
        mcpServers: [],
        ...(opts._meta != null && { _meta: opts._meta }),
      })
    },

    /**
     * טוען session ACP קיים לפי sessionId.
     * עשוי לזרוק -32601 אם ה-CLI אינו תומך ביכולת loadSession.
     */
    async loadSession(opts: { cwd: string; sessionId: string; _meta?: AcpRequestMeta }) {
      return conn.loadSession({
        sessionId: opts.sessionId,
        cwd: opts.cwd,
        mcpServers: [],
        ...(opts._meta != null && { _meta: opts._meta }),
      })
    },

    /**
     * מפרט sessions מהסוכן.
     * עשוי לזרוק -32601 אם ה-CLI אינו תומך ביכולת listSessions.
     */
    async listSessions() {
      return conn.listSessions({})
    },

    // ─── slice session-delete: Commit 0 ───
    /**
     * מוחק session (session/list). `DeleteSessionResponse` הוא `{}` אפקטיבית → מחזירים void.
     * עשוי לזרוק -32601 אם ה-CLI אינו תומך ביכולת delete — הקורא (VM) מטפל.
     */
    async deleteSession(sessionId: string): Promise<void> {
      await conn.deleteSession({ sessionId })
    },

    /** שולח פרומפט (טקסט או blocks מולטימודלי) ב-session הנתון */
    // ─── slice-image-paste Commit 4a: backward-compatible (string עדיין עובד) ───
    async prompt(sessionId: string, content: string | PromptBlocks) {
      return conn.prompt({ sessionId, prompt: buildPromptParam(content) })
    },

    /** מבטל פעולה פעילה ב-session הנתון */
    async cancel(sessionId: string) {
      return conn.cancel({ sessionId })
    },

    /** סוגר את התעבורה הבסיסית */
    close() {
      transport.close()
    },

    // ─── slice FE-normalization: ext channel ───

    /** passthrough ל-ClientSideConnection.extMethod — ה-facade (adapters) מאמת לפני. */
    async extMethod(
      method: string,
      params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      return conn.extMethod(method, params) as Promise<Record<string, unknown>>
    },

    // ─── session config (slice 23) ───

    /** מגדיר אפשרות config על סשן פתוח. discriminated union לפי typeof value. */
    async setSessionConfigOption(opts: {
      sessionId: string
      configId: string
      value: string | boolean
    }): Promise<SetSessionConfigOptionResponse> {
      if (typeof opts.value === "boolean") {
        return conn.setSessionConfigOption({
          sessionId: opts.sessionId,
          configId: opts.configId,
          type: "boolean" as const,
          value: opts.value,
        })
      }
      return conn.setSessionConfigOption({
        sessionId: opts.sessionId,
        configId: opts.configId,
        value: opts.value,
      })
    },

    /** משנה את ה-mode של סשן פתוח. */
    async setSessionMode(opts: {
      sessionId: string
      modeId: string
    }): Promise<SetSessionModeResponse> {
      return conn.setSessionMode({ sessionId: opts.sessionId, modeId: opts.modeId })
    },

    /** משנה את המודל של סשן פתוח (unstable API). */
    async setSessionModel(opts: { sessionId: string; modelId: string }): Promise<void> {
      await conn.setSessionConfigOption({
        sessionId: opts.sessionId,
        configId: "model",
        value: opts.modelId,
      })
    },
  }
}

export async function createAcpClient(
  transport: AcpTransport,
  onUpdateOrCallbacks: ((n: SessionNotification) => void) | AcpClientCallbacks,
  options: AcpClientOptions = {},
): Promise<AcpClient> {
  const initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS

  // תמיכה בשתי חתימות: callback ישיר (backward-compat) + object
  const callbacks: AcpClientCallbacks =
    typeof onUpdateOrCallbacks === "function"
      ? { onUpdate: onUpdateOrCallbacks }
      : onUpdateOrCallbacks

  // בניית streams + connection — ה-SDK מתחיל לקרוא מהצינור מיד.
  const stream = ndJsonStream(transport.writable, transport.readable)
  const client = createClientImpl({
    onUpdate: callbacks.onUpdate,
    onExtNotification: callbacks.onExtNotification,
    onRequestPermission: callbacks.onRequestPermission,
  })
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
    if (isAuthRequiredError(e)) {
      const authErr = new Error(
        `ACP agent requires authentication: ${e.message ?? "auth_required"}. ` +
          `Run in shell: '<cli> auth login'.`,
      )
      ;(authErr as Error & { kind?: string }).kind = "auth_required"
      transport.close()
      throw authErr
    }
    transport.close()
    throw e
  }

  // authenticate גנרי — רק כש-authMethods לא ריק (Cursor: cursor_login, Grok: cached_token/grok.com).
  // opencode/gemini/qoder/claude/codex לא מציעים authMethods → לא נוגעים כלל, אין רגרסיה.
  const authMethodId = resolveAuthMethodId(initResult.authMethods)
  if (authMethodId) {
    try {
      await conn.authenticate({ methodId: authMethodId })
    } catch (e) {
      // auth_required אמיתי → פאטלי (כמו initialize). כל שגיאה אחרת (כמו -32603
      // "not implemented" של opencode, שמכריז authMethods בלי ליישם את ה-RPC בפועל)
      // → לא-פאטלי: log + המשך כאילו authenticate לא נקרא. מונע רגרסיה (calev NO-GO).
      if (isAuthRequiredError(e)) {
        transport.close()
        const authErr = new Error(
          `ACP agent authentication failed (methodId: ${authMethodId}): ${e.message ?? String(e)}. ` +
            `Run in shell: '<cli> auth login'.`,
        )
        ;(authErr as Error & { kind?: string }).kind = "auth_required"
        throw authErr
      }
      const err = e as { message?: string }
      console.warn(
        `[acp] authenticate(methodId=${authMethodId}) failed non-fatally — agent declared authMethods but RPC not implemented; continuing: ${err?.message ?? String(e)}`,
      )
    }
  }

  return buildAcpClientFacade(conn, transport, initResult.agentCapabilities)
}

// ─── slice warm-reattach-skip-init: נתיב warm reattach ───────────────────────

export type AttachedAcpClientOptions = {
  /**
   * capabilities ידועות מבחוץ. warm reattach אין לו תגובת initialize לשאוב ממנה.
   * משמש רק supportsImageInput (רדום מאחורי IMAGE_INPUT_ENABLED).
   * NormalizedCapabilities מגיע מ-_drive/capabilities (ws-agent.ts:87) — לא מושפע.
   * ברירת-מחדל: אובייקט ריק בטוח.
   */
  capabilities?: AcpClient["capabilities"]
}

/**
 * createAttachedAcpClient — בונה AcpClient על transport פתוח, **ללא** קריאת initialize.
 *
 * מיועד ל-warm reattach: הסוכן כבר חי ואותחל, חיבור WS חדש נפתח אליו.
 * שליחת initialize נוסף גורמת ל-Codex לזרוק "Already initialized" → לולאת סוקטים.
 *
 * הנתיב: ndJsonStream → ClientSideConnection → buildAcpClientFacade, ללא conn.initialize.
 * הקורא אחראי להמתין ל-waitForOpen לפני הקריאה לפונקציה זו.
 *
 * סינכרוני (בניגוד ל-createAcpClient) — אין await על initialize.
 * `await createAttachedAcpClient(...)` תקין (await על non-Promise לא גורם נזק).
 */
export function createAttachedAcpClient(
  transport: AcpTransport,
  onUpdateOrCallbacks: ((n: SessionNotification) => void) | AcpClientCallbacks,
  options: AttachedAcpClientOptions = {},
): AcpClient {
  const callbacks: AcpClientCallbacks =
    typeof onUpdateOrCallbacks === "function"
      ? { onUpdate: onUpdateOrCallbacks }
      : onUpdateOrCallbacks

  const stream = ndJsonStream(transport.writable, transport.readable)
  const client = createClientImpl({
    onUpdate: callbacks.onUpdate,
    onExtNotification: callbacks.onExtNotification,
    onRequestPermission: callbacks.onRequestPermission,
  })
  const conn = new ClientSideConnection((_agent) => client, stream)

  // capabilities מבחוץ (ברירת-מחדל: אובייקט ריק — raw caps משמש רק supportsImageInput הרדום)
  const capabilities = options.capabilities ?? ({} as AcpClient["capabilities"])

  return buildAcpClientFacade(conn, transport, capabilities)
}
