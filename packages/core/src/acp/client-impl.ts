/**
 * client-impl.ts — מימוש ממשק ה-ACP `Client` (אגנוסטי לתעבורה).
 *
 * אסטרטגיה:
 * - requestPermission: מדיניות allow_once אוטומטית (ללא UI בשלב זה — slice עתידי).
 * - sessionUpdate: מועבר למטרה דרך callback onUpdate.
 * - fs.readTextFile / writeTextFile: לא מוצהר (clientCapabilities.fs = false).
 *   opencode קורא מהדיסק דרך קריאות tool פנימיות שלו (לא ACP fs caps).
 *
 * המודול הזה הוא לוגיקה טהורה — ללא I/O, ללא DOM, ללא Node APIs. נעשה בו שימוש גם
 * ב-FE (browser WS transport) וגם בכל ACP client עתידי בצד ה-BE.
 */
import type { Client, SessionNotification } from "@agentclientprotocol/sdk"

export function createClientImpl(opts: { onUpdate: (n: SessionNotification) => void }): Client {
  return {
    /**
     * Auto-allow_once: מעדיף allow_once > allow_always > הראשון שאינו reject > האפשרות הראשונה.
     * Slices עתידיים יוסיפו פרומפט UI לאישור משתמש.
     */
    async requestPermission(params) {
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

    // fs.readTextFile + writeTextFile: לא מוצהר.
    // clientCapabilities.fs = { readTextFile: false, writeTextFile: false }
    // opencode משתמש בקריאות fs tool פנימיות שלו — לא זקוק ל-ACP fs caps ב-MVP.
  }
}
