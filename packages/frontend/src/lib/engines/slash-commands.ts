/**
 * slash-commands.ts — matching טהור עבור השלמת פקודות-slash בתיבת-הכתיבה.
 * (slice-slash-commands, Commit 1)
 *
 * טהור לחלוטין (engine, אין browser/DOM) — לוגיקת ה-parsing/matching בלבד.
 * ה-glue של ה-dropdown (state, keydown) חי ב-component (Commit 2).
 */

import type { AvailableCommand } from "@agentclientprotocol/sdk"

export interface SlashMatch {
  /** ה-query שהוקלד אחרי "/" (לפני הרווח הראשון), כמו-שהוא */
  query: string
  /** הפקודות שתואמות ל-query (prefix, case-insensitive) */
  matches: AvailableCommand[]
}

/**
 * מחזיר null כאשר הקלט אינו במצב "הקלדת-פקודה":
 *  - לא מתחיל ב-"/" (הפקודה תקפה רק כתו הראשון), או
 *  - כבר יש רווח אחרי ה-token (המשתמש מקליד ארגומנטים → סוגרים dropdown).
 * אחרת: query + הפקודות המסוננות (prefix על name, case-insensitive; query ריק → כל הפקודות).
 */
export function matchSlashCommands(
  input: string,
  commands: readonly AvailableCommand[],
): SlashMatch | null {
  if (!input.startsWith("/")) return null

  const rest = input.slice(1)
  if (rest.includes(" ")) return null

  const query = rest
  const queryLower = query.toLowerCase()
  const matches = commands.filter((cmd) => cmd.name.toLowerCase().startsWith(queryLower))

  return { query, matches }
}

/** הערך החדש ל-textarea אחרי בחירה: "/<name> " (רווח נגרר להתחלת ארגומנטים). */
export function applySlashSelection(command: AvailableCommand): string {
  return `/${command.name} `
}
