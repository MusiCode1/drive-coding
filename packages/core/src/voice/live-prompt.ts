/**
 * live-prompt.ts — everything the model reads (Hebrew allowed here only).
 *
 * Slice: live-contract-gemini, Commit 0.
 */

/** Prefix on agent-answer delivery context — not a user request (slice live-secretary fix1 §1). */
export const LIVE_AGENT_DELIVERY_MARKER = "[תשובת-סוכן]"

/** Prefix on pending-permission notification context (slice live-secretary fix1 §2). */
export const LIVE_PERMISSION_PENDING_MARKER = "[בקשת-הרשאה]"

/** Wraps an agent answer for speakable delivery so the secretary does not re-dispatch it. */
export function formatAgentDelivery(text: string): string {
  return `${LIVE_AGENT_DELIVERY_MARKER} ${text}`
}

/** Builds a speakable notification when a permission request arrives. */
export function formatPermissionPending(opts: {
  toolTitle: string
  options: readonly { optionId: string; name: string }[]
}): string {
  const list = opts.options.map((o) => `${o.optionId}: ${o.name}`).join("; ")
  return `${LIVE_PERMISSION_PENDING_MARKER} ${opts.toolTitle}. אפשרויות: ${list}`
}

/** Action and parameter descriptions keyed by action name. */
export const LIVE_ACTION_PROSE: Readonly<
  Record<string, { description: string; params: Readonly<Record<string, string>> }>
> = {
  compose_prompt: {
    description:
      "נסח ושלח בקשה לסוכן הקוד בשם המשתמש. מחזיר קבלה מיידית; התשובה מגיעה בערוץ אחר. " +
      "אם קיבלת status:not_sent — אמור למשתמש שהבקשה לא נשלחה ומדוע; אל תאשר שליחה.",
    params: { text: "הבקשה המנוסחת במלואה." },
  },
  forward: {
    description:
      "העבר את בקשת המשתמש כלשונה לסוכן הקוד, בלי לנסח מחדש. " +
      "אם קיבלת status:not_sent — אמור למשתמש שהבקשה לא נשלחה ומדוע; אל תאשר שליחה.",
    params: {},
  },
  cancel_turn: {
    description: "בטל את הריצה הנוכחית של הסוכן.",
    params: {},
  },
  answer_permission: {
    description:
      "ענה על בקשת אישור מהסוכן (allow / deny / always). " +
      "אם קיבלת status:not_sent — אמור למשתמש שלא ניתן לאשר ומדוע; אל תאשר שליחה.",
    params: { optionId: "מזהה האפשרות מהרשימה שהודיעה [בקשת-הרשאה]." },
  },
  set_mode: {
    description: "החלף מצב ממשק (נהיגה / שולחן).",
    params: { mode: "drive או desk." },
  },
  run_slash_command: {
    description: "הרץ פקודת slash ידועה.",
    params: { name: "שם הפקודה." },
  },
  playback: {
    description: "שלוט בהשמעת התשובה האחרונה.",
    params: { op: "stop · repeat · prev · next." },
  },
  read_last: {
    description: "קרא בקצרה את התשובה האחרונה של הסוכן.",
    params: {},
  },
  status: {
    description: "דווח על מצב הסוכן (עסוק / פנוי).",
    params: {},
  },
  search_session: {
    description: "חפש בהיסטוריית השיחה הנוכחית.",
    params: { query: "מילות חיפוש." },
  },
  remember_session: {
    description:
      "שמור מסקנה או הנחיה לשכבת-הסשן. אל תכתוב סיכומים של מה שכבר נאמר — רק מסקנות והנחיות שהוסקו.",
    params: {
      text: "המסקנה או ההנחיה לשמירה.",
      id: "מזהה קיים לעדכון; השמט לפריט חדש.",
    },
  },
  remember_always: {
    description:
      "שמור העדפת משתמש לשכבה חוצה-סשנים. אל תכתוב סיכומים של מה שכבר נאמר — רק מסקנות והנחיות שהוסקו.",
    params: {
      text: "ההעדפה לשמירה.",
      id: "מזהה קיים לעדכון; השמט לפריט חדש.",
    },
  },
}

const IDENTIFIER_SECTION =
  "מזהים טכניים (שם קובץ, מספר שורה, פקודה, ערך) — צטט כלשונם, אל תנסח אותם מחדש."

const LANGUAGE_SECTION =
  "נסח בקשות בשפת המשתמש. אם המשתמש דיבר עברית — הנוסח לסוכן חייב להיות בעברית, " +
  "אך המזהים הטכניים חייבים להישמר כפי שנאמרו."

const NO_CLARIFY_SECTION =
  "אל תשאל שאלות הבהרה על בקשות קוד. כל בקשה שנוגעת לקוד — קרא מיד לכלי compose_prompt עם ניסוח מלא."

const AGENT_DELIVERY_SECTION =
  `טקסט שמתחיל ב-${LIVE_AGENT_DELIVERY_MARKER} הוא דיווח מהסוכן שיש למסור למשתמש בקול — ` +
  "התייחס אליו כתשובת הסוכן, אל תייחס אותו למשתמש, ואל תשגר אותו מחדש לסוכן ב-compose_prompt. " +
  `הסמן עצמו הוא מטא-מידע — לעולם אל תקריא אותו בקול. מסור רק את התוכן שאחריו. ` +
  `אותו כלל חל על ${LIVE_PERMISSION_PENDING_MARKER}.`

const PERMISSION_PENDING_SECTION =
  `טקסט שמתחיל ב-${LIVE_PERMISSION_PENDING_MARKER} מודיע על בקשת אישור ממתינה — ` +
  "הסבר למשתמש מה נדרש וקרא answer_permission עם optionId מהרשימה."

/** Builds the secretary system prompt. */
export function buildLiveSecretaryPrompt(opts?: { language?: "he" | "en" }): string {
  const lang = opts?.language ?? "he"
  const role =
    lang === "he"
      ? "אתה מזכיר קולי לעוזר-קוד."
      : "You are a voice secretary for a coding assistant."

  return [
    role,
    IDENTIFIER_SECTION,
    LANGUAGE_SECTION,
    NO_CLARIFY_SECTION,
    AGENT_DELIVERY_SECTION,
    PERMISSION_PENDING_SECTION,
  ].join("\n")
}
