/**
 * describeCrash — פונקציית עזר טהורה שבונה סיבת קריסה קריאה למשתמש
 * ממידע על יציאת bridge ו-stderr.
 *
 * סדר עדיפות (הגבוה ביותר מנצח):
 *   1. שגיאת ספק שחולצה מ-stderr (extractProviderError)
 *      — הכי שימושית: "Your credit balance is too low"
 *   2. שגיאת spawn (ENOENT, EACCES, וכו')
 *      — למשל: "ENOENT: spawn npx ENOENT"
 *   3. Signal (SIGKILL, SIGTERM, וכו')
 *      — למשל: "Killed by signal SIGKILL"
 *   4. קוד יציאה שאינו אפס
 *      — למשל: "Exited with code 127"
 *   5. undefined — יציאה נקייה (code 0) או באמת אין מידע
 *
 * כל המחרוזות הן אנגלית/טכניות — שכבת ה-UI מוסיפה תוויות locale מעליהן.
 */

import { extractProviderError } from "./acp-provider-error.js"

export type BridgeCrashInfo = {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | string | null
  /** מאוכלס כאשר הקריסה נובעת מ-child.on("error") — spawn ENOENT וכו' */
  readonly spawnError?: { readonly code?: string; readonly message: string }
}

const STDERR_REASON_MAX_LEN = 200
const STDERR_REASON_LOOKBACK = 30

/**
 * lastStderrReason — פונקציה טהורה: מחזירה שורת-stderr אחת שסבירה כ"סיבת קריסה".
 *
 * heuristic best-effort (לא הבטחה — ראה §5 בבריף):
 *   1. מעדיפה שורה שמכילה /error|fatal|panic|failed/i מבין ~30 השורות האחרונות.
 *   2. אחרת — השורה האחרונה הלא-ריקה (מדלגת על ריקות/whitespace).
 * חתוכה ל-~200 תווים.
 */
function lastStderrReason(stderrLines: ReadonlyArray<string>): string | undefined {
  for (
    let i = stderrLines.length - 1;
    i >= 0 && i >= stderrLines.length - STDERR_REASON_LOOKBACK;
    i--
  ) {
    const line = stderrLines[i]?.trim()
    if (line && /error|fatal|panic|failed/i.test(line)) {
      return line.slice(0, STDERR_REASON_MAX_LEN)
    }
  }
  for (let i = stderrLines.length - 1; i >= 0; i--) {
    const line = stderrLines[i]?.trim()
    if (line) return line.slice(0, STDERR_REASON_MAX_LEN)
  }
  return undefined
}

export function describeCrash(
  info: BridgeCrashInfo,
  stderrLines: ReadonlyArray<string>,
): string | undefined {
  // 1. שגיאת ספק מ-stderr (LLM API 400/401/429)
  const provider = extractProviderError(stderrLines as string[])
  if (provider) return provider

  // 2. שגיאת spawn (ENOENT, EACCES, וכו')
  if (info.spawnError) {
    const { code, message } = info.spawnError
    return code ? `${code}: ${message}` : message
  }

  // 3. Signal
  if (info.signal) return `Killed by signal ${info.signal}`

  // 4. קוד יציאה שאינו אפס — צרף את סיבת ה-stderr אם יש (heuristic, §5 בבריף)
  if (info.exitCode !== null && info.exitCode !== 0) {
    const reason = lastStderrReason(stderrLines)
    return reason
      ? `Exited with code ${info.exitCode}: ${reason}`
      : `Exited with code ${info.exitCode}`
  }

  // 5. יציאה נקייה או אין מידע — אין סיבה להציג
  return undefined
}
