/**
 * history.ts — GET /api/agents/:id/history.
 *
 * ─── slice history-get C1 (TDD) ───
 *
 * משיכת ההיסטוריה של סשן חי כ-**pull** רגיל: אותו רצף `updates` שה-SSE שולח
 * ב-frame-zero, כ-JSON. כל צרכן שאינו יכול להחזיק SSE — סקריפט, בדיקה, client
 * חדש — מקבל את אותה תמונה, כולל ה-`carried` (‏`plan` וחבריו) וחותמות-הזמן.
 *
 * 🔴 **מקור אחד.** הגוף הוא `snapshotPayload(state)` כמות שהוא — אותה פונקציה
 * ש-`snapshotFrame` בונה עליה (`core/session/wire-frames.ts`). אין כאן בנייה
 * מקבילה של המטען: שני מימושים שנראים זהים היום נפרדים מחר בשקט.
 *
 * שלוש הכרעות שקל לחזור בהן בטעות:
 *
 * 1. **`getHost`, לא `getOrCreateHost`** — משיכת-קריאה לא תייצר host, לא תפנה
 *    בעלים ולא תיגע ב-epoch. אין host ⇒ 404 עם אותו גוף כמו `state.ts`.
 *    היסטוריה של סשן **קר** היא מחוץ ל-scope.
 * 2. **בלי `epoch` בתשובה** — ה-epoch מזהה מי מחזיק בזרם. ‏GET אינו מחזיק בזרם
 *    ואינו נרשם כ-connection, ולכן epoch כאן היה מזמין לקוח לחשוב שהוא בעלים.
 *    ‏`version` כן חוזר: הוא "איפה אנחנו ברצף".
 * 3. **בלי `touchOwner`** — משיכה אינה אות-חיות. ואין `bindScopeEnforcement`:
 *    הוא אכיפת-**כתיבה**, וזו קריאה.
 */

import { snapshotPayload } from "@drive-coding/core/session"
import type { Hono } from "hono"
import type { AgentSessionRegistry } from "../registry.js"

/**
 * registerHistoryRoute — registers GET /api/agents/:id/history on the Hono app.
 */
export function registerHistoryRoute(app: Hono, registry: AgentSessionRegistry): void {
  app.get("/api/agents/:id/history", (c) => {
    const agentId = c.req.param("id")

    const host = registry.getHost(agentId)
    if (!host) {
      return c.json({ error: "Agent connection not found" }, 404)
    }

    return c.json(snapshotPayload(host.state), 200)
  })
}
