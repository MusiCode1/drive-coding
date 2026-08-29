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
    description:
      "בטל רק את הריצה שרצה עכשיו אצל סוכן הקוד. לא מוחק קבצים, לא מבטל תור שכבר נגמר, " +
      "ולא מוחק עבודה שכבר נכתבה. אם אין תור פתוח — אין מה לבטל.",
    params: {},
  },
  pause_live: {
    description:
      "השהה שליחת מיקרופון לשיחה החיה; הסוקט נשאר פתוח. " +
      "אם כבר מושהה — מחזיר already_paused. חידוש רק בכפתור Resume, אין כלי resume.",
    params: {},
  },
  close_live: {
    description:
      "סגור את השיחה החיה (לא cancel_turn — זה תור סוכן הקוד). " +
      "קודם אמור שלום בקול, אחר כך קרא לכלי; אל תסגור באמצע משפט.",
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
    description:
      "חפש בהיסטוריית השיחה לפי מילות מפתח. לא מחזיר את כל ההודעות — רק קטעים שתואמים לשאילתה. " +
      "אם המשתמש רוצה את ההודעות האחרונות בלי חיפוש — השתמש ב-read_recent.",
    params: { query: "מילות חיפוש." },
  },
  read_recent: {
    description:
      "החזר את כמה הפריטים האחרונים בשיחה לפי סדר כרונולוגי. בלי שאילתה. " +
      "ברירת מחדל: טקסט משתמש/סוכן ושמות כלים בלבד — בלי מחשבות ובלי ארגומנטים/פלט. " +
      "thoughts=true מוסיף מחשבות. toolCalls=true מחזיר קריאות כלים מלאות. " +
      "messages=false משמיט את טקסט השיחה — כך: רק מחשבות, רק כלים, או שניהם. " +
      "ברירת מחדל 8, לכל היותר 20. אם טענת שאין לך גישה להודעות, קרא לכלי הזה קודם.",
    params: {
      count: "כמה פריטים אחרונים להחזיר (1–20). השמט ל-8.",
      thoughts: "true כדי לכלול מחשבות פנימיות. ברירת מחדל false.",
      toolCalls: "true לקריאות כלים מלאות (שם, ארגומנטים, פלט). ברירת מחדל false — רק שם.",
      messages: "false כדי להשמיט הודעות משתמש/סוכן. ברירת מחדל true.",
    },
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
  "התפקיד העיקרי שלך הוא לתווך: להעביר הודעות בין המשתמש לסוכן הקוד ולהיפך, " +
  "כדי לאפשר למשתמש לדבר עם הסוכן בקול. " +
  "ענה בעצמך על שאלות רגילות (שעה, מזג אוויר אם ידוע, שיחה קצרה) ועל היכולות שלך כמזכיר — " +
  "מה הכלים שלך עושים, מתי אתה שולח לסוכן. " +
  "אל תחווה דעה על יכולות סוכן הקוד, על איכות התשובות שלו, או על איך יצא לו — " +
  "מסור את דבריו, ושאלו אותו אם המשתמש שואל עליו. " +
  "בלי להגיד \"אני יכול רק דברים שקשורים לקוד\". " +
  "שלח לסוכן (compose_prompt / forward) כשהמשתמש מבקש עבודה על קוד, קבצים, " +
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

const HISTORY_TOOLS_SECTION =
  "הודעות השיחה: בפתיחה מקבלים כמה תורות אחרונים בדחיפה, ואחר כך תשובות שנדחפות. " +
  "זה לא כל ההיסטוריה. כדי לראות עוד — חובה להשתמש בכלים: " +
  "read_recent לחתך אחרון בלי חיפוש, search_session למילות מפתח. " +
  "אל תגיד שאין לך גישה להודעות בלי לקרוא לאחד מהם."

const LIVE_SESSION_CONTROL_SECTION =
  "סיום והשהיה של השיחה החיה: «ביי», «סיימנו» ודומה — קודם אמור שלום בקול, אחר כך close_live. " +
  "אל תסגור באמצע משפט. השהיה בלי לסיים את השיחה — pause_live (הסוקט נשאר). " +
  "חידוש אחרי השהיה — רק כפתור Resume; אין כלי resume קולי."

type LivePromptTool = {
  name: string
  description: string
  params: readonly { name: string; required: boolean; description: string }[]
}

/** Names in declaration order — keep in sync with LIVE_ACTION_SHAPES (tested). */
export const LIVE_SECRETARY_TOOL_ORDER = [
  "compose_prompt",
  "forward",
  "cancel_turn",
  "pause_live",
  "close_live",
  "answer_permission",
  "search_session",
  "read_recent",
  "remember_session",
  "remember_always",
  "list_config",
  "set_session_config",
  "set_app_setting",
] as const

export function formatLiveToolsSection(tools: readonly LivePromptTool[]): string {
  const lines = ["כלים — זה מה שכל כלי עושה באמת. אל תמציא התנהגות אחרת:"]
  for (const t of tools) {
    const sig =
      t.params.length === 0
        ? `${t.name}()`
        : `${t.name}(${t.params.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ")})`
    lines.push(`- ${sig}: ${t.description}`)
  }
  return lines.join("\n")
}

function toolsFromProse(): LivePromptTool[] {
  return LIVE_SECRETARY_TOOL_ORDER.map((name) => {
    const prose = LIVE_ACTION_PROSE[name]
    if (!prose) throw new Error(`Missing prose for action: ${name}`)
    const requiredGuess: Record<string, boolean> = {
      text: true,
      optionId: true,
      query: true,
      id: name === "set_session_config",
      value: true,
      key: true,
      count: false,
      thoughts: false,
      toolCalls: false,
      messages: false,
    }
    const paramNames = Object.keys(prose.params)
    return {
      name,
      description: prose.description,
      params: paramNames.map((p) => ({
        name: p,
        required: requiredGuess[p] ?? false,
        description: prose.params[p] ?? "",
      })),
    }
  })
}

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
export function buildLiveSecretaryPrompt(opts?: {
  language?: "he" | "en"
  tools?: readonly LivePromptTool[]
}): string {
  const lang = opts?.language ?? "he"
  const role =
    lang === "he"
      ? "אתה מזכיר קולי: מתווך בין המשתמש לסוכן הקוד — מעביר הודעות לשני הכיוונים כדי לאפשר שיחה קולית עם הסוכן. מפעיל כלים כשצריך."
      : "You are a voice secretary: a relay between the user and the coding agent — pass messages both ways so the user can talk to the agent. Use tools when needed."

  return [
    role,
    SCOPE_SECTION,
    HISTORY_TOOLS_SECTION,
    LIVE_SESSION_CONTROL_SECTION,
    CONFIG_TOOLS_SECTION,
    formatLiveToolsSection(opts?.tools ?? toolsFromProse()),
    IDENTIFIER_SECTION,
    LANGUAGE_SECTION,
    AGENT_DELIVERY_SECTION,
    PERMISSION_PENDING_SECTION,
  ].join("\n")
}
