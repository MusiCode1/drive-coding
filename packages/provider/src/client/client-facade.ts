import type {
  ClientSideConnection,
  NewSessionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeResponse,
} from "@agentclientprotocol/sdk"
import type { SessionListQuery } from "@drive-coding/core/session"
import type { AcpTransport } from "../transport/types.js"
import type { AcpClient } from "./client.js"

type AcpRequestMeta = NewSessionRequest["_meta"]

// ─── slice-image-paste: PromptBlocks + buildPromptParam ───
/** projection טהור מה-SDK — ContentBlock[]; drift אפס. */
type PromptRequest = Parameters<ClientSideConnection["prompt"]>[0]
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

// Shared by clients created through initialize and by warm reattaches.
export function buildAcpClientFacade(
  conn: ClientSideConnection,
  transport: AcpTransport,
  capabilities: AcpClient["capabilities"],
  authMethods: AcpClient["authMethods"],
): AcpClient {
  return {
    conn,
    capabilities,
    authMethods,

    /** יוצר session ACP חדש */
    async newSession(opts: {
      cwd: string
      mcpServers: NewSessionRequest["mcpServers"]
      _meta?: AcpRequestMeta
    }) {
      return conn.newSession({
        cwd: opts.cwd,
        mcpServers: opts.mcpServers,
        ...(opts._meta != null && { _meta: opts._meta }),
      })
    },

    /**
     * טוען session ACP קיים לפי sessionId.
     * עשוי לזרוק -32601 אם ה-CLI אינו תומך ביכולת loadSession.
     */
    async loadSession(opts: {
      cwd: string
      sessionId: string
      mcpServers: NewSessionRequest["mcpServers"]
      _meta?: AcpRequestMeta
    }) {
      return conn.loadSession({
        sessionId: opts.sessionId,
        cwd: opts.cwd,
        mcpServers: opts.mcpServers,
        ...(opts._meta != null && { _meta: opts._meta }),
      })
    },

    /**
     * מפרט sessions מהסוכן.
     * עשוי לזרוק -32601 אם ה-CLI אינו תומך ביכולת listSessions.
     */
    async listSessions(options: SessionListQuery = {}) {
      return conn.listSessions(options)
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
