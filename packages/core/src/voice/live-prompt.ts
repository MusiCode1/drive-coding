/**
 * live-prompt.ts — everything the model reads (Hebrew allowed here only).
 *
 * Slice: live-contract-gemini, Commit 0.
 * Slice: live-config-control, Commit 1 — config action prose + Hebrew seed line.
 */

import type { ConfigSnapshot } from "./live-config.js"

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
  list_config: {
    description:
      "הצג את כל הגדרות הסשן והאפליקציה הנוכחיות — מודל, מצב, אופציות, מסך, שפה, ערכה. " +
      "קרא לפני set_session_config או set_app_setting כדי לדעת אילו id וערכים חוקיים.",
    params: {},
  },
  set_session_config: {
    description:
      "שנה הגדרת סשן (מודל, מצב, thinking, או כל אופציה מ-list_config). " +
      "השתמש רק ב-id ובערכים שחזרו מ-list_config — אל תנחש modelId. " +
      "ל-boolean שלח \"true\" או \"false\".",
    params: {
      id: "מזהה ההגדרה מ-list_config (model · mode · thinking · או id של אופציה).",
      value: "ערך חוקי מה-choices של list_config.",
    },
  },
  set_app_setting: {
    description:
      "שנה הגדרת אפליקציה: מסך דלוק, שפה, או ערכת צבעים. " +
      "מפתחות: screenWakeLock (true/false) · locale (he/en) · theme (שם ערכה מ-list_config).",
    params: {
      key: "screenWakeLock · locale · theme.",
      value: "ערך חוקי למפתח.",
    },
  },
}

const IDENTIFIER_SECTION =
  "מזהים טכניים (שם קובץ, מספר שורה, פקודה, ערך) — צטט כלשונם, אל תנסח אותם מחדש."

const LANGUAGE_SECTION =
  "נסח בקשות בשפת המשתמש. אם המשתמש דיבר עברית — הנוסח לסוכן חייב להיות בעברית, " +
  "אך המזהים הטכניים חייבים להישמר כפי שנאמרו."

const SCOPE_SECTION =
  "אתה מדבר עם המשתמש ישירות. ענה בעצמך על שאלות רגילות (שעה, מזג אוויר אם ידוע, " +
  "מה אתה יכול לעשות, שיחה קצרה) — בלי לשלוח אותן לסוכן הקוד ובלי להגיד " +
  '"אני יכול רק דברים שקשורים לקוד". ' +
  "שלח לסוכן (compose_prompt / forward) רק כשהמשתמש מבקש עבודה על קוד, קבצים, " +
  "ריצה, דיבוג, או משהו שדורש את עוזר-הקוד. " +
  "על בקשות קוד — אל תשאל הבהרות; קרא מיד לכלי עם ניסוח מלא."

const AGENT_DELIVERY_SECTION =
  `טקסט שמתחיל ב-${LIVE_AGENT_DELIVERY_MARKER} הוא דיווח מהסוכן שיש למסור למשתמש בקול — ` +
  "התייחס אליו כתשובת הסוכן, אל תייחס אותו למשתמש, ואל תשגר אותו מחדש לסוכן ב-compose_prompt. " +
  `הסמן עצמו הוא מטא-מידע — לעולם אל תקריא אותו בקול. מסור רק את התוכן שאחריו. ` +
  `אותו כלל חל על ${LIVE_PERMISSION_PENDING_MARKER}.`

const PERMISSION_PENDING_SECTION =
  `טקסט שמתחיל ב-${LIVE_PERMISSION_PENDING_MARKER} מודיע על בקשת אישור ממתינה — ` +
  "הסבר למשתמש מה נדרש וקרא answer_permission עם optionId מהרשימה."

const CONFIG_TOOLS_SECTION =
  "לשנות הגדרות סשן (מודל, מצב, thinking), מסך דלוק, שפה, או ערכת צבעים — " +
  "השתמש ב-list_config ואז set_session_config / set_app_setting. " +
  "אל תנחש ערכים; קרא list_config קודם."

const CONFIG_SEED_LABELS: Record<string, string> = {
  model: "מודל",
  mode: "מצב",
  thinking: "חשיבה",
  screenWakeLock: "מסך",
  locale: "שפה",
  theme: "ערכה",
}

const LOCALE_LABELS: Record<string, string> = { he: "עברית", en: "English" }

const THINKING_LABELS: Record<string, string> = {
  off: "כבוי",
  low: "נמוכה",
  medium: "בינונית",
  high: "גבוהה",
}

/** Hebrew config status line for silent Live context injection. */
export function formatConfigSeedProse(snapshot: ConfigSnapshot): string {
  const parts: string[] = ["[הגדרות נוכחיות]"]

  if (snapshot.session.model?.id) {
    const name = snapshot.session.model.name ?? snapshot.session.model.id
    parts.push(`${CONFIG_SEED_LABELS.model}=${name}`)
  }
  if (snapshot.session.mode?.id) {
    const name = snapshot.session.mode.name ?? snapshot.session.mode.id
    parts.push(`${CONFIG_SEED_LABELS.mode}=${name}`)
  }
  for (const opt of snapshot.session.options) {
    if (opt.current === null) continue
    const label = opt.name || opt.id
    const v = typeof opt.current === "boolean" ? (opt.current ? "כן" : "לא") : opt.current
    parts.push(`${label}=${v}`)
  }
  if (snapshot.session.thinking !== undefined) {
    parts.push(
      `${CONFIG_SEED_LABELS.thinking}=${THINKING_LABELS[snapshot.session.thinking.level] ?? snapshot.session.thinking.level}`,
    )
  }

  parts.push(
    `${CONFIG_SEED_LABELS.screenWakeLock}=${snapshot.app.screenWakeLock ? "דלוק" : "כבוי"}`,
  )
  parts.push(
    `${CONFIG_SEED_LABELS.locale}=${LOCALE_LABELS[snapshot.app.locale] ?? snapshot.app.locale}`,
  )
  parts.push(`${CONFIG_SEED_LABELS.theme}=${snapshot.app.theme}`)

  return parts.join(" ")
}

/** Builds the secretary system prompt. */
export function buildLiveSecretaryPrompt(opts?: { language?: "he" | "en" }): string {
  const lang = opts?.language ?? "he"
  const role =
    lang === "he"
      ? "אתה מזכיר קולי: מדבר עם המשתמש, ומפעיל כלים כשצריך — כולל שליחה לעוזר-קוד."
      : "You are a voice secretary: talk to the user directly, and use tools when needed — including sending work to the coding assistant."

  return [
    role,
    SCOPE_SECTION,
    CONFIG_TOOLS_SECTION,
    IDENTIFIER_SECTION,
    LANGUAGE_SECTION,
    AGENT_DELIVERY_SECTION,
    PERMISSION_PENDING_SECTION,
  ].join("\n")
}
