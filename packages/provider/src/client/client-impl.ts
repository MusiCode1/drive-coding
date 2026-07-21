/**
 * client-impl.ts — מימוש ממשק ה-ACP `Client` (אגנוסטי לתעבורה).
 *
 * אסטרטגיה:
 * - requestPermission: מדיניות allow_once אוטומטית (ללא UI בשלב זה — slice עתידי).
 * - sessionUpdate: מועבר למטרה דרך callback onUpdate.
 * - extNotification: מועבר ל-onExtNotification אם סופק (slice FE-normalization).
 *   SDK default-routes notification לא-מוכר → extNotification. כך מגיע `_drive/capabilities`.
 * - fs.readTextFile / writeTextFile: לא מוצהר (clientCapabilities.fs = false).
 *   opencode קורא מהדיסק דרך קריאות tool פנימיות שלו (לא ACP fs caps).
 *
 * המודול הזה הוא לוגיקה טהורה — ללא I/O, ללא DOM, ללא Node APIs. נעשה בו שימוש גם
 * ב-FE (browser WS transport) וגם בכל ACP client עתידי בצד ה-BE.
 */
import type {
  Client,
  CreateElicitationRequest,
  CreateElicitationResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk"

/** נגזר מ-SDK — לא shape מותאם; drift אפס. ר' docs/plans/slice-permission-ui-basic.md §4 Commit 0. */
type PermissionParams = Parameters<Client["requestPermission"]>[0]
type PermissionResponse = Awaited<ReturnType<Client["requestPermission"]>>

/**
 * ─── slice-elicitation-ui: elicitation/create ─── נגזר מ-SDK דרך ייבוא ישיר (לא
 * Parameters<Client["unstable_createElicitation"]>) — השדה אופציונלי על Client, לכן
 * Parameters<...> נכשל ב-TS2344 (כולל undefined). CreateElicitationRequest/Response
 * מיוצאים מ-root ה-SDK (אין subpath /schema ב-exports map). ר' docs/plans/
 * slice-elicitation-ui.md §4 Commit 0.
 */
type ElicitationParams = CreateElicitationRequest
type ElicitationResponse = CreateElicitationResponse

export function createClientImpl(opts: {
  onUpdate: (n: SessionNotification) => void
  /** ─── slice FE-normalization: קבלת ext notifications (כולל _drive/capabilities) ─── */
  onExtNotification?: (method: string, params: Record<string, unknown>) => void
  /**
   * ─── slice-permission-ui-basic: בקשת הרשאה חיה ─── אם מסופק, requestPermission
   * מאציל אליו את ההחלטה (round-trip ל-UI). ללא handler → auto-allow הקיים (ללא שינוי
   * התנהגות ברירת-מחדל — regression test מכסה זאת).
   */
  onRequestPermission?: (params: PermissionParams) => Promise<PermissionResponse>
  /**
   * ─── slice-elicitation-ui: שאלה מובנת חיה ─── אם מסופק, unstable_createElicitation
   * מאציל אליו את ההחלטה (round-trip ל-UI, מחקה onRequestPermission). ללא handler →
   * default `{action:"cancel"}` (כי היום אין UI; לא לתקוע turn / לזרוק method-not-found).
   */
  onCreateElicitation?: (params: ElicitationParams) => Promise<ElicitationResponse>
}): Client {
  return {
    /**
     * אם onRequestPermission סופק (UI חי) → מאציל אליו.
     * אחרת: Auto-allow_once — מעדיף allow_once > allow_always > הראשון שאינו reject >
     * האפשרות הראשונה. (ברירת המחדל ההיסטורית, נשמרת ללא UI.)
     */
    async requestPermission(params) {
      if (opts.onRequestPermission) {
        return await opts.onRequestPermission(params)
      }

      const byKind = (k: string) => params.options.find((o) => o.kind === k)
      const chosen =
        byKind("allow_once") ??
        byKind("allow_always") ??
        params.options.find((o) => !o.kind.startsWith("reject")) ??
        params.options[0]

      if (!chosen) {
        return { outcome: { outcome: "cancelled" } }
      }
      return { outcome: { outcome: "selected", optionId: chosen.optionId } }
    },

    async sessionUpdate(notification) {
      opts.onUpdate(notification)
    },

    // ─── slice-elicitation-ui: unstable_createElicitation ───
    // אם onCreateElicitation סופק (UI חי) → מאציל אליו. אחרת → default cancel (לא לתקוע turn).
    async unstable_createElicitation(params: ElicitationParams): Promise<ElicitationResponse> {
      if (opts.onCreateElicitation) {
        return await opts.onCreateElicitation(params)
      }
      return { action: "cancel" }
    },

    // ─── slice FE-normalization: extNotification ───
    // SDK (ClientSideConnection) default-routes notification לא-מוכר → extNotification.
    // `_drive/capabilities` מגיע כ-raw JSON-RPC notification → נקלט כאן.
    async extNotification(method: string, params: Record<string, unknown>) {
      opts.onExtNotification?.(method, params)
    },

    /**
     * Cursor ACP blocking extensions (and other agent→client ext requests).
     * MVP: safe auto-answers so turns do not stall without a UI.
     */
    async extMethod(method: string, _params: Record<string, unknown>) {
      if (method === "cursor/ask_question") {
        return { outcome: { outcome: "skipped" } }
      }
      if (method === "cursor/create_plan") {
        return { outcome: { outcome: "accepted" } }
      }
      return {}
    },

    // fs.readTextFile + writeTextFile: לא מוצהר.
    // clientCapabilities.fs = { readTextFile: false, writeTextFile: false }
    // opencode משתמש בקריאות fs tool פנימיות שלו — לא זקוק ל-ACP fs caps ב-MVP.
  }
}
