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
 */

import type { AcpClient } from "@drive-coding/provider/client"
import { parseExtParams } from "@drive-coding/provider/extensions"

export type ExtClient = {
  /**
   * מגדיר את מגבלת ה-thinking tokens ל-session הנתון.
   * n=null → ביטול המגבלה (no-limit). זורק אם params לא תקינים.
   */
  setThinkingTokens(sessionId: string, n: number | null): Promise<void>
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
  }
}
