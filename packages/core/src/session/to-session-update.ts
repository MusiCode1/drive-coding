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
  const _meta = mergeMeta(m.meta, midMeta(m))
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
 * ‏`SessionState` → רצף ה-updates שמשחזר אותו מאפס.
 *
 * 🟢 **זה הכיווץ, והוא יוצא טבעית.** ה-CLI הזרים 71 chunks; ה-state מחזיק
 * הודעה אחת; ולכן ה-snapshot הוא הודעה אחת. הלקוח **אינו יכול להבחין** אם
 * הטקסט הגיע ב-chunk אחד או ב-71 — וזו בדיוק הסיבה שאין צורך במנגנון-כיווץ
 * נפרד (§2.2). המדידה שחייבה זאת: claude מכווץ ב-`session/load`, ‏OMP החזיר
 * **אפס פריימי-שחזור**. אותו פרוטוקול, שתי התנהגויות ⇒ מכווצים בעצמנו.
 */
export function stateToSessionUpdates(state: SessionState): WireSessionUpdate[] {
  const out: WireSessionUpdate[] = state.messages.map(messageToUpdate)
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
