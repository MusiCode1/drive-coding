import {
  type ChannelFrame,
  createInitialSessionState,
  reduce,
  type SessionState,
  type WireSessionUpdate,
} from "@drive-coding/core/session"

/**
 * יחידת-המעבר על החוט — ‏slice acp-wire-session-update.
 *
 * ⚠️ **מערך, לא update יחיד.** מעבר-מצב אחד בשרת (patch אחד) יכול להתפצל
 * לכמה `session/update` — למשל `update-session` עם title+commands. כולם
 * חולקים את אותו `version`, ולכן פיצולם לפריימים נפרדים היה שובר את
 * סינון-החפיפה (`version <= lastVersion`) שהיה מוחק את השני והשלישי.
 * ⇒ הפריים הוא היחידה האטומית; ה-`version` שלו מגיע משורת ה-`id:`.
 */
export type WireUpdateBatch = { version: number; updates: WireSessionUpdate[] }

/** גוף ה-snapshot (frame-zero). */
type WireSnapshot = {
  sessionId: string | null
  version: number
  updates: WireSessionUpdate[]
}

/**
 * מחלץ את ה-updates מ-batch של JSON-RPC.
 *
 * ⚠️ **הוולידציה כאן רופפת במכוון, וזה לא רשלנות.** קודמתה (`PatchSchema`)
 * יכלה להיות הדוקה כי `Patch` הוא טיפוס סגור שלנו; `session/update` הוא
 * משטח **פתוח** — הפרוטוקול עצמו מצהיר שערכי `sessionUpdate` לא-מוכרים
 * שמורים לווריאנטים עתידיים, וזה בדיוק מה שנושא את `plan` דרך ה-BE בלי
 * שיבין אותו. סכימה הדוקה כאן הייתה **מוחקת** אותם — אותה מחלקת-כשל
 * שהתיקון `opaque` נועד לסגור. ⇒ נבדק רק המסגור: מערך, ובכל איבר
 * `params.update` שהוא אובייקט עם `sessionUpdate` מחרוזתי.
 */
function extractUpdates(raw: unknown): WireSessionUpdate[] | null {
  if (!Array.isArray(raw)) return null
  const out: WireSessionUpdate[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null
    const params = (item as { params?: unknown }).params
    if (typeof params !== "object" || params === null) return null
    const update = (params as { update?: unknown }).update
    if (typeof update !== "object" || update === null) return null
    if (typeof (update as { sessionUpdate?: unknown }).sessionUpdate !== "string") return null
    out.push(update as WireSessionUpdate)
  }
  return out
}

/** מקפל את ה-snapshot למצב. ה-`version` נלקח מהשרת, לא מספירת ה-updates. */
function foldSnapshot(snap: WireSnapshot): SessionState {
  let state = createInitialSessionState({ sessionId: snap.sessionId ?? "" })
  for (const u of snap.updates) state = reduce(state, u).state
  // ⚠️ **דריסה מכוונת.** `reduce` מעלה מונה מקומי לכל update, אבל ה-`version`
  // הוא מונה של **השרת** — הוא מה שסימון-החפיפה של הלקוח נמדד מולו. ספירה
  // מקומית הייתה מייצרת בדיוק את רגרסיית-הגרסה שבאג #41 נבנה סביבה.
  return { ...state, sessionId: snap.sessionId, version: snap.version }
}

export function decodeSnapshotFrame(frame: ChannelFrame): SessionState {
  return foldSnapshot(JSON.parse(frame.data) as WireSnapshot)
}

type DecodedUpdate =
  | { kind: "batch"; batch: WireUpdateBatch }
  | { kind: "invalid-json" | "invalid-batch" | "invalid-id" }

export function decodeUpdateFrame(frame: ChannelFrame): DecodedUpdate {
  let raw: unknown
  try {
    raw = JSON.parse(frame.data)
  } catch {
    // Malformed JSON on the wire — skip it, keep draining subsequent frames.
    return { kind: "invalid-json" }
  }

  const updates = extractUpdates(raw)
  if (updates === null) return { kind: "invalid-batch" }
  // ⚠️ ה-`version` מגיע מ-`id:` ולא מהגוף. פריים בלי `id` תקין אינו
  // ניתן לסינון-חפיפה, ולכן הוא מסוכן יותר מפריים חסר — הוא היה
  // נספר כ-0 ונדחה לנצח מול כל watermark. ⇒ לדלג במפורש.
  const version = Number(frame.id)
  if (!Number.isFinite(version)) return { kind: "invalid-id" }

  return { kind: "batch", batch: { version, updates } }
}
