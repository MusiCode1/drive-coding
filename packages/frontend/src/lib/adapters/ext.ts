/**
 * ext.ts — ExtClient facade (adapters layer).
 *
 * Typed wrapper מעל AcpClient.extMethod: validates params against the unified
 * ext-methods schema (@drive-coding/provider/extensions) before sending.
 *
 * Design decisions (slice FE-normalization):
 *   - שכבת adapters (לא view-model) — ה-vm קורא ל-facade, לא לclient ישירות.
 *   - parseExtParams זורק על params לא תקינים (validation at the boundary).
 *   - ה-facade אגנוסטי לספק — רק capabilities+schema, לא cliKind.
 *
 * slice session-budget-meter Commit 4: getQuota מאמת גם את ה-result (לא רק params) —
 * facade היחיד ב-FE שמותר לו לדעת על parseExtResult; ה-VM מקבל QuotaSnapshot|null מוכן.
 */

import type { AcpClient } from "@drive-coding/provider/client"
import { parseExtParams, parseExtResult, type QuotaSnapshot } from "@drive-coding/provider/extensions"

export type ExtClient = {
  /**
   * מגדיר את מגבלת ה-thinking tokens ל-session הנתון.
   * n=null → ביטול המגבלה (no-limit). זורק אם params לא תקינים.
   */
  setThinkingTokens(sessionId: string, n: number | null): Promise<void>
  /**
   * שולף snapshot מכסה גנרי (רב-ספקי) ל-session הנתון. null = אין מגבלות זמינות
   * (תגובה תקינה, לא שגיאה). זורק אם params/result לא תקינים.
   */
  getQuota(sessionId: string): Promise<QuotaSnapshot | null>
}

/**
 * יוצר ExtClient facade מעל ה-AcpClient הנתון.
 * ה-vm קורא ל-createExtClient(this.#client) אחרי יצירת ה-client.
 */
export function createExtClient(client: AcpClient): ExtClient {
  return {
    async setThinkingTokens(sessionId: string, n: number | null): Promise<void> {
      const params = parseExtParams("_drive/setThinkingTokens", { sessionId, n })
      await client.extMethod("_drive/setThinkingTokens", params as Record<string, unknown>)
    },
    async getQuota(sessionId: string): Promise<QuotaSnapshot | null> {
      const params = parseExtParams("_drive/getQuota", { sessionId })
      const raw = await client.extMethod("_drive/getQuota", params as Record<string, unknown>)
      const result = parseExtResult("_drive/getQuota", raw)
      return result.snapshot
    },
  }
}
