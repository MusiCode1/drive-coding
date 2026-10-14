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
/** תקציב-בתים לנתח. ‏נבחר ולא נגזר — ‏ר' §9 ש1. */
export const SNAPSHOT_CHUNK_MAX_BYTES = 2_000_000

export type SnapshotPayload = {
  sessionId: string | null
  version: number
  epoch?: number
  updates: WireSessionUpdate[]
  /** נוכח רק בפריימי snapshot מרובי-נתחים. ‏נעדר ⇒ ‏נתח יחיד וסופי. */
  chunk?: { i: number; more: boolean }
}

export function snapshotPayload(
  state: SessionState,
  epoch?: number,
  opts?: StateToSessionUpdatesOptions,
): SnapshotPayload {
  return {
    sessionId: state.sessionId,
    version: state.version,
    ...(epoch !== undefined ? { epoch } : {}),
    updates: stateToSessionUpdates(state, opts),
  }
}

/**
 * frame-zero — המטען של `snapshotPayload`, עטוף במסגור SSE.
 *
 * ה-`id:` הוא ה-**version** ולא ה-epoch: ה-epoch מזהה *מי מחזיק בזרם*
 * וה-version מזהה *איפה אנחנו ברצף*. ה-epoch עבר לגוף ההודעה.
 */
export function snapshotFrame(state: SessionState, epoch?: number): SseFrame {
  return {
    event: "snapshot",
    id: String(state.version),
    data: JSON.stringify(snapshotPayload(state, epoch)),
  }
}

const snapshotBytesEncoder = new TextEncoder()

function wireUpdateUtf8Bytes(u: WireSessionUpdate): number {
  return snapshotBytesEncoder.encode(JSON.stringify(u)).length
}

function snapshotChunkPayload(
  state: SessionState,
  updates: WireSessionUpdate[],
  chunk: { i: number; more: boolean } | undefined,
  epoch?: number,
): SnapshotPayload {
  return {
    sessionId: state.sessionId,
    version: state.version,
    ...(epoch !== undefined ? { epoch } : {}),
    updates,
    ...(chunk !== undefined ? { chunk } : {}),
  }
}

function snapshotChunkFrame(
  state: SessionState,
  updates: WireSessionUpdate[],
  chunk: { i: number; more: boolean } | undefined,
  epoch?: number,
): SseFrame {
  return {
    event: "snapshot",
    id: String(state.version),
    data: JSON.stringify(snapshotChunkPayload(state, updates, chunk, epoch)),
  }
}

/**
 * ‏`state` → ‏רשימת פריימי `snapshot`, חתוכה לפי תקציב-בתים.
 * ‏תמיד מחזיר **לפחות פריים אחד**, גם על state ריק.
 * ‏האחרון תמיד נושא `chunk.more === false` (או `chunk` נעדר — נתח יחיד סופי).
 */
export function snapshotFrames(
  state: SessionState,
  epoch?: number,
  opts?: { maxBytes?: number },
): SseFrame[] {
  const maxBytes = opts?.maxBytes ?? SNAPSHOT_CHUNK_MAX_BYTES
  const allUpdates = snapshotPayload(state).updates

  if (allUpdates.length === 0) {
    return [snapshotChunkFrame(state, [], { i: 0, more: false }, epoch)]
  }

  const chunks: WireSessionUpdate[][] = []
  let current: WireSessionUpdate[] = []
  let currentBytes = 0

  for (const u of allUpdates) {
    const uBytes = wireUpdateUtf8Bytes(u)
    if (current.length > 0 && currentBytes + uBytes > maxBytes) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    current.push(u)
    currentBytes += uBytes
    if (uBytes > maxBytes) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
  }
  if (current.length > 0) {
    chunks.push(current)
  }

  if (chunks.length === 1) {
    const only = chunks[0]
    if (only === undefined) {
      return [snapshotChunkFrame(state, [], { i: 0, more: false }, epoch)]
    }
    const chunkMeta = state.messages.length === 0 ? ({ i: 0, more: false } as const) : undefined
    return [snapshotChunkFrame(state, only, chunkMeta, epoch)]
  }

  return chunks.map((updates, i) =>
    snapshotChunkFrame(
      state,
      updates,
      { i, more: i < chunks.length - 1 },
      i === 0 ? epoch : undefined,
    ),
  )
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
