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

import { type HistoryPage, selectRange } from "./history-range"
import {
  messageWireByteSize,
  patchToSessionUpdates,
  type StateToSessionUpdatesOptions,
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
 * מטען ה-snapshot — המצב המלא, מכווץ, כרצף `session/update`.
 *
 * ─── slice history-get C0 ───
 *
 * 🔴 **מקור אחד, שני פֶּה.** המטען הזה יוצא בשני מסלולים: ‏frame-zero של ה-SSE
 * (‏`snapshotFrame` למטה) ו-`GET /api/agents/:id/history` ב-BE. שני מימושים
 * שנראים זהים היום נפרדים מחר בשקט — ולכן `snapshotFrame` **קורא לכאן** ואינו
 * מחזיק עותק. ‏`history.ts` מחזיר את המטען הזה כמות שהוא.
 *
 * ה-`epoch` אופציונלי בכוונה: הוא מזהה *מי מחזיק בזרם*, ומשיכת-`GET` אינה
 * מחזיקה בזרם ואינה נרשמת כ-connection. שם הוא **נעדר** — לא `undefined` —
 * כדי שלא יזמין לקוח לחשוב שהוא בעלים.
 *
 * ─── slice history-cursor C1 ───
 *
 * 🔴 **ה-`opts` מושחל דרך כאן, ולא נבנה מטען מקביל ב-`history.ts`.** המסלול
 * בפועל של ה-GET הוא `history.ts` → `snapshotPayload` → `stateToSessionUpdates`;
 * חיתוך שהיה נבנה ב-BE היה שובר את כלל מקור-אחד, וגלאי-הסטייה של סלייס B
 * משווה רק את המקרה **בלי** חיתוך ולכן היה נשאר ירוק בשקט.
 *
 * ⚠️ ‏`snapshotFrame` **אינו** מקבל `opts` — ה-SSE frame-zero הוא תמיד מלא.
 * זו הכרעת-scope ולא השמטה: ר' §2א בבריף.
 */
export type SnapshotPayload = {
  sessionId: string | null
  version: number
  epoch?: number
  updates: WireSessionUpdate[]
  page?: HistoryPage
  historyOmitted?: { messageCount: number }
}

export function snapshotPayload(
  state: SessionState,
  epoch?: number,
  opts?: StateToSessionUpdatesOptions,
): SnapshotPayload {
  let page: HistoryPage | undefined
  let messageSlice: { start: number; end: number } | undefined
  if (opts?.range) {
    const sized = selectRange(state, opts.range, messageWireByteSize)
    if (!sized.ok) {
      return {
        sessionId: state.sessionId,
        version: state.version,
        ...(epoch !== undefined ? { epoch } : {}),
        updates: [],
      }
    }
    page = sized.page
    messageSlice = { start: sized.start, end: sized.end }
  }
  const historyOmitted =
    opts?.history === "omit" ? { messageCount: state.messages.length } : undefined
  const mergedOpts: StateToSessionUpdatesOptions | undefined =
    messageSlice !== undefined ? { ...opts, messageSlice } : opts
  return {
    sessionId: state.sessionId,
    version: state.version,
    ...(epoch !== undefined ? { epoch } : {}),
    updates: stateToSessionUpdates(state, mergedOpts),
    ...(page !== undefined ? { page } : {}),
    ...(historyOmitted !== undefined ? { historyOmitted } : {}),
  }
}

/**
 * frame-zero — המטען של `snapshotPayload`, עטוף במסגור SSE.
 *
 * ה-`id:` הוא ה-**version** ולא ה-epoch: ה-epoch מזהה *מי מחזיק בזרם*
 * וה-version מזהה *איפה אנחנו ברצף*. ה-epoch עבר לגוף ההודעה.
 */
export function snapshotFrame(
  state: SessionState,
  epoch?: number,
  mode: "full" | "meta" = "full",
): SseFrame {
  const opts: StateToSessionUpdatesOptions | undefined =
    mode === "meta" ? { history: "omit" } : undefined
  return {
    event: "snapshot",
    id: String(state.version),
    data: JSON.stringify(snapshotPayload(state, epoch, opts)),
  }
}

/**
 * ‏patch יחיד → פריים יחיד, או `null` כשאין לו ביטוי על החוט.
 *
 * @param stateAfter המצב **אחרי** ה-patch — נדרש כי `append-segment`/
 *   `update-tool` נושאים `targetId` בלבד, וסוג-ה-update תלוי ב-role של היעד.
 */
export function updateFrame(
  stateAfter: SessionState,
  patch: Patch,
  mode: "full" | "meta" = "full",
): SseFrame | null {
  let updates = patchToSessionUpdates(stateAfter, patch)
  if (mode === "meta" && patch.op === "reset") {
    updates = [
      { sessionUpdate: "_drive/reset" },
      ...stateToSessionUpdates(stateAfter, { history: "omit" }),
    ]
  }
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
