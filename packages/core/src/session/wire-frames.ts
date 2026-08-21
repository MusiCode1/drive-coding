/**
 * wire-frames.ts — המסגור של זרם ה-SSE, במקום אחד.
 *
 * ─── slice acp-wire-session-update ───
 *
 * ⚠️ **למה זה בליבה ולא ב-BE.** המסגור היה מוטבע ב-`events.ts` כתבניות-מחרוזת,
 * וכל טסט שרצה לדמות זרם בנה אותו מחדש ביד. ⇒ צורת-החוט הייתה כתובה בעשרה
 * מקומות, והטסטים קיבעו **העתק** שלה במקום אותה. שינוי-מסגור אמיתי נראה
 * אז כמו 99 טסטים אדומים שצריך "לתקן" — וזה בדיוק המצב שבו מתקנים טסט
 * לכיוון הלא-נכון. כאן יש מקור-אמת אחד, ולשני הצדדים.
 */

import {
  patchToSessionUpdates,
  stateToSessionUpdates,
  type WireSessionUpdate,
} from "./to-session-update"
import type { Patch, SessionState } from "./types"

export type SseFrame = { event: string; id?: string; data: string }

/** ‏JSON-RPC notification יחיד של `session/update`. */
function notification(sessionId: string | null, update: WireSessionUpdate): unknown {
  return { jsonrpc: "2.0", method: "session/update", params: { sessionId, update } }
}

/**
 * frame-zero — המצב המלא, מכווץ, כרצף `session/update`.
 *
 * ה-`id:` הוא ה-**version** ולא ה-epoch: ה-epoch מזהה *מי מחזיק בזרם*
 * וה-version מזהה *איפה אנחנו ברצף*. ה-epoch עבר לגוף ההודעה.
 */
export function snapshotFrame(state: SessionState, epoch?: number): SseFrame {
  return {
    event: "snapshot",
    id: String(state.version),
    data: JSON.stringify({
      sessionId: state.sessionId,
      version: state.version,
      ...(epoch !== undefined ? { epoch } : {}),
      updates: stateToSessionUpdates(state),
    }),
  }
}

/**
 * ‏patch יחיד → פריים יחיד, או `null` כשאין לו ביטוי על החוט.
 *
 * @param stateAfter המצב **אחרי** ה-patch — נדרש כי `append-segment`/
 *   `update-tool` נושאים `targetId` בלבד, וסוג-ה-update תלוי ב-role של היעד.
 */
export function updateFrame(stateAfter: SessionState, patch: Patch): SseFrame | null {
  const updates = patchToSessionUpdates(stateAfter, patch)
  if (updates.length === 0) return null
  return {
    event: "update",
    id: String(patch.version),
    // מערך = batch של JSON-RPC 2.0. ‏patch אחד יכול להתפצל לכמה updates
    // שכולם חולקים version — פיצולם לפריימים נפרדים היה שובר את סינון
    // החפיפה של הלקוח (`version <= lastVersion`), שהיה מוחק את כל השאר.
    data: JSON.stringify(updates.map((u) => notification(stateAfter.sessionId, u))),
  }
}

/** פריים → הבתים שעל החוט. */
export function serializeFrame(f: SseFrame): string {
  const id = f.id === undefined ? "" : `id: ${f.id}\n`
  return `event: ${f.event}\n${id}data: ${f.data}\n\n`
}
