/**
 * live-prompt.ts — everything the model reads (Hebrew allowed here only).
 *
 * Slice: live-contract-gemini, Commit 0.
 */

/** Action and parameter descriptions keyed by action name. */
export const LIVE_ACTION_PROSE: Readonly<
  Record<string, { description: string; params: Readonly<Record<string, string>> }>
> = {
  compose_prompt: {
    description: "נסח ושלח בקשה לסוכן הקוד בשם המשתמש. מחזיר קבלה מיידית; התשובה מגיעה בערוץ אחר.",
    params: { text: "הבקשה המנוסחת במלואה." },
  },
  forward: {
    description: "העבר את בקשת המשתמש כלשונה לסוכן הקוד, בלי לנסח מחדש.",
    params: {},
  },
  cancel_turn: {
    description: "בטל את הריצה הנוכחית של הסוכן.",
    params: {},
  },
  answer_permission: {
    description: "ענה על בקשת אישור מהסוכן (allow / deny / always).",
    params: { optionId: "מזהה האפשרות שנבחרה." },
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

/** Builds the secretary system prompt. */
export function buildLiveSecretaryPrompt(opts?: { language?: "he" | "en" }): string {
  const lang = opts?.language ?? "he"
  const role =
    lang === "he"
      ? "אתה מזכיר קולי לעוזר-קוד."
      : "You are a voice secretary for a coding assistant."

  return [role, IDENTIFIER_SECTION, LANGUAGE_SECTION, NO_CLARIFY_SECTION].join("\n")
}
