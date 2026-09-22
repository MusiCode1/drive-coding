/**
 * to-session-update.ts — ‏`Patch` → `session/update`, ו-`SessionState` → snapshot.
 *
 * ─── slice acp-wire-session-update (צעד 3 ב-`pre-brief-plan-acp-alignment`) ───
 *
 * זהו התפר שבו `Patch` **יורד מהחוט**. הוא נשאר טיפוס פנימי — ה-FE מקפל
 * `session/update` ב-`reduce` ומקבל ממנו Patches להחלה מוטבילית — אבל אף
 * `Patch` אינו נוסע יותר בין התהליכים.
 *
 * ⚠️ **המפה אינה חד-חד-ערכית, ובכוונה.** ‏`update-session` הוא שק של 11 שדות
 * שנולד מנוחות-מימוש; ל-ACP יש בית קנוני רק לשבעה מהם. הפיצול כאן הוא עיקר
 * העבודה של צעד 3, וכל שאר השורות הן כמעט שינוי-שם.
 *
 * ⚠️ **ארבעה שדות נשארים תחת `_drive/`, ולא מפני שהתעצלנו.** `status`,
 * ‏`pending`, ‏`capabilities` ו-`quota` **אינם מצב-סשן ב-ACP**: הרשאה, למשל,
 * היא שם **בקשה** (`session/request_permission`) ולא שדה. אצלנו היא הפכה
 * למצב דווקא מפני שבקשה-ותשובה אינה יכולה לחצות SSE. ⇒ הסימון `_drive/` הוא
 * התיאור הנכון של הפער, לא כיסוי עליו.
 */

import type { Patch, SessionMessage, SessionState } from "./types"

/** פריים כפי שהוא נוסע על החוט. `unknown` בשדות — הצרכן הוא `reduce`. */
export type WireSessionUpdate = Record<string, unknown> & { sessionUpdate: string }

/**
 * ‏v2 דורש `messageId` על כל chunk והודעה; אצלנו הוא יכול להיות `null`
 * (‏Gemini אינו שולח אחד). נופלים ל-id הסינתטי — הוא ייחודי ויציב, ולכן
 * הקיבוץ בצד המקבל יוצא זהה.
 */
const midOf = (m: SessionMessage): string => m.messageId ?? m.id

/**
 * ⚠️ **הנפילה ל-id הסינתטי היא איבוד-מידע, ולכן הערך האמיתי נוסע ב-`_meta`.**
 *
 * ‏Gemini אינו שולח `messageId`, ו-v2 דורש אחד — אז אנחנו ממציאים. אבל
 * ‏`messageId` הוא **מפתח-הקיבוץ** של chunks, ולא רק תווית: אם הצד המקבל
 * ישמור `"m_0"` במקום `null`, כל השוואה עתידית מול המצב שבשרת נעשית מול ערך
 * אחר. במקום להסתפק ב"זה עובד כי שני הצדדים ממציאים אותו דבר", ה-`_meta`
 * מחזיר את הערך המקורי — וה-round-trip יוצא **שווה**, לא רק שקול.
 *
 * מוחזר רק כשיש מה לתקן; הודעה עם messageId אמיתי אינה נושאת מטען מיותר.
 */
const midMeta = (m: SessionMessage): Record<string, unknown> | undefined =>
  m.messageId === null ? { "_drive/messageId": null } : undefined

/**
 * ‏`SessionMessage.timestamp` נוסע כשדה-מטא על פריים ההודעה השלמה.
 *
 * ⚠️ **למה `_meta` ולא `carried`.** ה-timestamp הוא כבר מצב-מחלקה-ראשונה
 * ב-`SessionState`; לשחזרו בהשמעת ה-blob-ים הגולמיים של `_claude/sdkMessage`
 * פירושו לאחסן מטען לא-חסום כדי לשלוף ממנו מחרוזת ISO אחת. ⇒ שדה-מטא.
 *
 * ‏ACP שומר `_meta` בדיוק להרחבות תלויות-מימוש, ולקוח שמתעלם ממנו מקבל
 * תמונה נכונה, רק בלי שעון-המקור.
 *
 * מוחזר רק כשיש חותמת; הודעה בלעדיה אינה נושאת מטען מיותר.
 *
 * ─── slice carried-snapshot C0 ───
 */
const tsMeta = (m: SessionMessage): Record<string, unknown> | undefined =>
  m.role !== "tool" && m.timestamp !== undefined ? { "_drive/timestamp": m.timestamp } : undefined

/** ממזג `_meta` של ההודעה עם זה שאנחנו מוסיפים, בלי לדרוס אף אחד. */
function mergeMeta(
  ...parts: (Record<string, unknown> | undefined)[]
): Record<string, unknown> | undefined {
  const merged = Object.assign({}, ...parts.filter(Boolean)) as Record<string, unknown>
  return Object.keys(merged).length > 0 ? merged : undefined
}

const CHUNK_KIND = {
  user: "user_message_chunk",
  thought: "agent_thought_chunk",
  assistant: "agent_message_chunk",
} as const

const WHOLE_KIND = {
  user: "user_message",
  thought: "agent_thought",
  assistant: "agent_message",
} as const

/** הודעה שלמה → update יחיד. כלי מקבל `tool_call_update` (ב-v2 הוא גם היוצר). */
function messageToUpdate(m: SessionMessage): WireSessionUpdate {
  if (m.role === "tool") {
    const tc = m.toolCall
    return {
      sessionUpdate: "tool_call_update",
      toolCallId: tc.toolCallId,
      title: tc.title ?? tc.name,
      ...(tc.kind !== undefined ? { kind: tc.kind } : {}),
      status: tc.status,
      ...(tc.args !== undefined ? { rawInput: tc.args } : {}),
      ...(tc.result !== undefined ? { rawOutput: tc.result } : {}),
      ...(tc.content !== undefined ? { content: tc.content } : {}),
      ...(tc.locations !== undefined ? { locations: tc.locations } : {}),
      ...(m.meta !== undefined ? { _meta: m.meta } : {}),
    }
  }
  const content: unknown[] = []
  const text = m.segments.map((s) => s.text).join("")
  if (text) content.push({ type: "text", text })
  for (const a of m.attachments ?? []) {
    content.push({ type: "image", mimeType: a.mimeType, data: a.dataBase64 })
  }
  const _meta = mergeMeta(m.meta, midMeta(m), tsMeta(m))
  return {
    sessionUpdate: WHOLE_KIND[m.role],
    messageId: midOf(m),
    content,
    ...(_meta !== undefined ? { _meta } : {}),
  }
}

/** ה-changes שיש להם בית קנוני, כל אחד ל-update משלו. */
function changesToUpdates(changes: Record<string, unknown>): WireSessionUpdate[] {
  const out: WireSessionUpdate[] = []

  if ("title" in changes) {
    out.push({ sessionUpdate: "session_info_update", title: changes.title })
  }
  if ("commands" in changes) {
    out.push({ sessionUpdate: "available_commands_update", availableCommands: changes.commands })
  }
  if ("configOptions" in changes) {
    out.push({ sessionUpdate: "config_option_update", configOptions: changes.configOptions })
  }
  if ("modes" in changes) {
    // ⚠️ `current_mode_update` הוא קנוני ב-v1 ו-v2 **הסיר** אותו: שם ה-modes
    // הם config-options. אצלנו הם עדיין שדה נפרד ב-SessionState, שמוזן מהחוט
    // של הספק. פליטת השם ה-v1 היא התיאור הכן של המצב — לא `_drive/`, כי זה
    // לא המצאה שלנו, וגם לא העמדת-פנים שזה v2.
    const modes = changes.modes as { currentModeId?: unknown } | null
    if (modes && typeof modes.currentModeId === "string") {
      out.push({ sessionUpdate: "current_mode_update", currentModeId: modes.currentModeId })
    }
  }
  if ("contextUsage" in changes) {
    const u = changes.contextUsage as { used?: unknown; size?: unknown; cost?: unknown } | null
    if (u && typeof u.used === "number" && typeof u.size === "number") {
      out.push({ sessionUpdate: "usage_update", used: u.used, size: u.size, cost: u.cost })
    }
  }

  // turnState + lastTurnError → state_update אחד. השניים נוסעים יחד תמיד:
  // ‏`idle` בלי הסיבה שלו הוא בדיוק אובדן-המידע שאנחנו מנסים למנוע.
  if ("turnState" in changes || "lastTurnError" in changes) {
    const turnState = changes.turnState as string | undefined
    const err = changes.lastTurnError as { message: string; at: number } | null | undefined
    if (turnState === "idle" || (turnState === undefined && err !== undefined)) {
      out.push({
        sessionUpdate: "state_update",
        state: "idle",
        stopReason: err ? err.message : "end_turn",
        ...(err ? { _meta: { "_drive/at": err.at } } : {}),
      })
    } else if (turnState !== undefined) {
      // ⚠️ **פריים אחד, שתי רזולוציות.** `state_update` מכיר שלוש דרגות ואנחנו
      // חמש; `running` לבדו היה מאבד את ההבחנה thinking/responding/calling-tool,
      // וה-UI היה מציג "ממתין" לאורך כל התור. ⇒ הגס נוסע בשדה הקנוני, העדין
      // ב-`_meta` — שזה בדיוק מה ש-ACP שומר אותו בשבילו. לקוח ACP סטנדרטי
      // שמתעלם מ-`_meta` עדיין מקבל תמונה נכונה, רק גסה יותר.
      out.push({
        sessionUpdate: "state_update",
        state: "running",
        _meta: { "_drive/turnState": turnState },
      })
    }
  }

  // ─── מה שאין לו בית ב-ACP ───
  const rest: Record<string, unknown> = {}
  for (const k of ["status", "pending", "capabilities", "quota"]) {
    if (k in changes) rest[k] = changes[k]
  }
  if (Object.keys(rest).length > 0) {
    out.push({ sessionUpdate: "_drive/session_update", changes: rest })
  }
  return out
}

/**
 * ‏`Patch` → ‏0..n `session/update`.
 *
 * @param state ה-state **אחרי** ה-patch. נדרש כי `append-segment`/`update-tool`
 *   נושאים `targetId` בלבד, וסוג-ה-update תלוי ב-role של היעד — מידע שקיים
 *   רק ב-state. זו הסיבה שאין כאן פונקציה טהורה של ה-patch לבדו.
 */
export function patchToSessionUpdates(state: SessionState, patch: Patch): WireSessionUpdate[] {
  switch (patch.op) {
    // 🟢 השורה היפה בקובץ: `opaque` נשא update שהליבה לא הבינה — ועל חוט
    // שהוא ממילא `session/update`, הוא פשוט **הוא עצמו**. אין מעטפת למחוק.
    case "opaque":
      return typeof patch.update === "object" && patch.update !== null
        ? [patch.update as WireSessionUpdate]
        : []

    case "add-message":
    case "set-message":
      return [messageToUpdate(patch.message)]

    case "append-segment": {
      const target = state.messages.find((m) => m.id === patch.targetId)
      if (!target || target.role === "tool") return []
      const chunkMeta = mergeMeta(target.meta, patch.meta, midMeta(target))
      return [
        {
          sessionUpdate: CHUNK_KIND[target.role],
          messageId: midOf(target),
          content: { type: "text", text: patch.segment.text },
          ...(chunkMeta !== undefined ? { _meta: chunkMeta } : {}),
        },
      ]
    }

    case "update-tool": {
      const target = state.messages.find((m) => m.id === patch.targetId)
      if (!target || target.role !== "tool") return []
      const tc = patch.toolCall
      const outMeta = mergeMeta(target.meta, patch.meta)
      return [
        {
          sessionUpdate: "tool_call_update",
          toolCallId: target.toolCall.toolCallId,
          ...(tc.status !== undefined ? { status: tc.status } : {}),
          ...(tc.title !== undefined ? { title: tc.title } : {}),
          ...(tc.kind !== undefined ? { kind: tc.kind } : {}),
          ...(tc.args !== undefined ? { rawInput: tc.args } : {}),
          ...(tc.result !== undefined ? { rawOutput: tc.result } : {}),
          ...(tc.content !== undefined ? { content: tc.content } : {}),
          ...(tc.locations !== undefined ? { locations: tc.locations } : {}),
          ...(outMeta !== undefined ? { _meta: outMeta } : {}),
        },
      ]
    }

    case "update-session": {
      const updates = changesToUpdates(patch.changes as Record<string, unknown>)
      if (patch.meta === undefined) return updates
      return updates.map((u) => ({
        ...u,
        _meta: mergeMeta(
          typeof u._meta === "object" && u._meta !== null
            ? (u._meta as Record<string, unknown>)
            : undefined,
          patch.meta,
        ),
      }))
    }

    // ‏`reset` הוא החלפת-הסשן, ואין לו מקבילה: ‏ACP פותר את זה בחיבור חדש.
    // אצלנו הזרם שורד את ההחלפה, ולכן היא חייבת לנסוע בו.
    case "reset":
      return [{ sessionUpdate: "_drive/reset" }]

    default:
      // ⚠️ ה-switch ממצה את הטיפוס, ולכן זו שורה שאינה אמורה לרוץ — אבל
      // ‏`Patch` מגיע גם מגבולות-ריצה (טסטים, skew בין builds), ושם
      // TypeScript אינו נוכח. בלי זה הפונקציה מחזירה `undefined` וה-`.length`
      // אצל הקורא זורק — כלומר op לא-מוכר היה מפיל את הזרם כולו.
      return []
  }
}

/**
 * ‏`findMessageIndex` — האינדקס של ההודעה שמזהה זה מצביע עליה, או **`-1`**.
 *
 * ─── slice history-cursor C0 ───
 *
 * ההתאמה בשני סבבים: ראשית על ה-id הסינתטי (`m_<seq>`) לאורך כל הרשימה,
 * ורק אם אף אחד לא התאים — על `messageId` של ACP. **הסדר אינו קוסמטי**:
 * ‏`messageId` הוא מזהה-ספק ואינו מובטח ייחודי מול מרחב ה-`m_<seq>`, ולכן
 * זהות-אמת גוברת על מפתח-קיבוץ.
 *
 * 🔴 **מחזיר סימן ואינו זורק.** ‏`AGENTS.md` קובע `Result`/סימן בליבה
 * ו-`throw` רק בקליפה, ואכן `rg "throw " packages/core/src/session/` מחזיר
 * אפס. ה-BE הוא שמתרגם את ה-`-1` ל-400.
 */
export function findMessageIndex(state: SessionState, id: string): number {
  const bySyntheticId = state.messages.findIndex((m) => m.id === id)
  if (bySyntheticId !== -1) return bySyntheticId
  return state.messages.findIndex((m) => m.messageId === id)
}

/**
 * ‏`SessionState` → רצף ה-updates שמשחזר אותו מאפס.
 *
 * 🟢 **זה הכיווץ, והוא יוצא טבעית.** ה-CLI הזרים 71 chunks; ה-state מחזיק
 * הודעה אחת; ולכן ה-snapshot הוא הודעה אחת. הלקוח **אינו יכול להבחין** אם
 * הטקסט הגיע ב-chunk אחד או ב-71 — וזו בדיוק הסיבה שאין צורך במנגנון-כיווץ
 * נפרד (§2.2). המדידה שחייבה זאת: claude מכווץ ב-`session/load`, ‏OMP החזיר
 * **אפס פריימי-שחזור**. אותו פרוטוקול, שתי התנהגויות ⇒ מכווצים בעצמנו.
 */
export type StateToSessionUpdatesOptions = {
  /**
   * חותכים את ההיסטוריה ומחזירים רק מההודעה הזאת ואילך.
   * ‏`m_<seq>` או ה-`messageId` של ACP — ר' `findMessageIndex`.
   *
   * 🔴 **מזהה שאינו נמצא ⇒ `[]`**, לא פלט-מלא ולא זריקה. הקובע הוא שקורא
   * עתידי שיבקש עוגן שנמחק לא יקבל "הכול" בשקט — בדיוק מחלקת-הכשל
   * שהסלייס סוגר. ה-BE אינו נשען על זה (הוא קורא ל-`findMessageIndex`
   * **לפני** ומתרגם ל-400), אבל הצורה מקובעת כאן כדי שלא תתפרש אחרת.
   */
  fromMessage?: string
}

export function stateToSessionUpdates(
  state: SessionState,
  opts?: StateToSessionUpdatesOptions,
): WireSessionUpdate[] {
  const out: WireSessionUpdate[] = []

  // ─── slice history-cursor C0: חיתוך לפי `fromMessage` ───
  //
  // בלי הארגומנט `cutIndex` הוא 0 וכל הדגלים למטה כבויים ⇒ **אותו קוד
  // בדיוק** שרץ לפני הסלייס. זו המלכודת הראשונה ב-§7 של הבריף.
  const cutting = opts?.fromMessage !== undefined && opts.fromMessage !== ""
  const cutIndex = cutting ? findMessageIndex(state, opts.fromMessage as string) : 0
  if (cutting && cutIndex === -1) return []
  const visible = cutting ? state.messages.slice(cutIndex) : state.messages

  // ─── slice carried-snapshot C3: שזירת ה-carried במיקומם ───
  //
  // 🔴 **המיקום אינו קוסמטי.** ‏`plan` ששייך לאמצע השיחה ונפלט בסוף היה
  // משנה את סדר-ההגעה שהצרכן רואה, וגם שובר את ה-round-trip: בשחזור הוא
  // היה נרשם עם `after` של ההודעה האחרונה במקום זו שאחריה הגיע.
  //
  // האינווריאנט שמחזיק את זה: סדר-המערך מתלכד עם סדר ה-`after`, כי רענון
  // הוא מחיקה + דחיפה לסוף (`recordCarried`). ⇒ מעבר יחיד לפי סדר המערך
  // בתוך כל עוגן מספיק, וה-`carried` המשוחזר יוצא זהה.
  const carried = state.carried ?? []

  // ─── slice history-cursor C0: מי מה-`carried` **יורד** בחיתוך ───
  //
  // 🔴 שלושת הענפים של §4.1.2, ובסדר הזה:
  //   (א) `after === null`  ⇒ יורד. ‏`null` לעולם אינו ברשימת-ההודעות, ולכן
  //       מבחן-"קיים ברשימה המלאה" לבדו היה מחזיר אותו כשייר — הפוך מהכלל.
  //   (ב) עוגן שקיים ברשימה המלאה אך נחתך ⇒ יורד, **ואינו שייר**.
  //   (ג) עוגן שאינו קיים כלל ⇒ שייר (מסלול-מת, נשמר להתנהגות).
  //
  // 🔴 **ההשוואה חייבת להיות מול רשימת-ההודעות המלאה.** לולאת-השיירים למטה
  // פולטת כל `carried` שעוגנו "אינו קיים"; היא מסלול-מת היום (`reset` מנקה),
  // אבל תחת חיתוך כל עוגן שנחתך נראה לה לא-קיים — וכל ה-`carried` הישן היה
  // חוזר דרך הדלת האחורית. לכן `allIds` נבנה מ-`state.messages` ולא מ-`visible`.
  const allIds = cutting ? new Set(state.messages.map((m) => m.id)) : undefined
  const keptIds = cutting ? new Set(visible.map((m) => m.id)) : undefined
  const isCutAway = (after: string | null): boolean => {
    if (!cutting) return false
    if (after === null) return true
    return allIds!.has(after) && !keptIds!.has(after)
  }

  const emitted = new Set<number>()
  const emitCarriedAfter = (anchor: string | null): void => {
    for (let i = 0; i < carried.length; i++) {
      const e = carried[i]
      if (e === undefined || emitted.has(i) || e.after !== anchor) continue
      emitted.add(i)
      if (typeof e.update === "object" && e.update !== null) {
        out.push(e.update as WireSessionUpdate)
      }
    }
  }

  // עוגנים שנחתכו מסומנים כ"כבר נפלטו" — כך הם אינם נשזרים, וגם אינם
  // נאספים בלולאת-השיירים. סימון אחד, שני מסלולים.
  for (let i = 0; i < carried.length; i++) {
    const e = carried[i]
    if (e !== undefined && isCutAway(e.after)) emitted.add(i)
  }

  emitCarriedAfter(null)
  for (const m of visible) {
    out.push(messageToUpdate(m))
    emitCarriedAfter(m.id)
  }

  // עוגן שאינו קיים ברשימת-ההודעות. לא אמור לקרות — `reset` מנקה את
  // ה-buffer יחד עם ההודעות — אבל להשמיט בשקט זה בדיוק הכשל שהסלייס סוגר.
  for (let i = 0; i < carried.length; i++) {
    const e = carried[i]
    if (e === undefined || emitted.has(i)) continue
    if (typeof e.update === "object" && e.update !== null) {
      out.push(e.update as WireSessionUpdate)
    }
  }

  out.push(
    ...changesToUpdates({
      title: state.title,
      commands: state.commands,
      configOptions: state.configOptions,
      modes: state.modes,
      contextUsage: state.contextUsage,
      turnState: state.turnState,
      lastTurnError: state.lastTurnError,
      status: state.status,
      pending: state.pending,
      capabilities: state.capabilities,
      quota: state.quota,
    }),
  )
  return out
}
