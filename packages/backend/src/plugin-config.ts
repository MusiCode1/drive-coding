import path from "node:path"
import { pathToFileURL } from "node:url"
import { isBinary } from "./binary.js"
import { ensurePluginExtracted } from "./plugin-extract.js"

/**
 * רשומת פלאגין בקונפיגורציה של opencode.
 * Commit 3 (windows-adaptation): opencode 1.2.27 דורש plugin: string[] בלבד —
 * לא tuple. הטקסט מועבר דרך env var PROMPT_INJECTOR_TEXT במקום options.
 */
type PluginEntry = string

/**
 * בונה OPENCODE_CONFIG_CONTENT להפעלת opencode עם הפלאגין הכללי
 * `prompt-injector` טעון. הטקסט מועבר דרך env PROMPT_INJECTOR_TEXT
 * (מוגדר על-ידי הqaller ב-childEnv של bridge-manager).
 * ממזג עם OPENCODE_CONFIG_CONTENT הקיים של המשתמש, אם ישנו.
 *
 * למה env var ולא קובץ פלאגין על הדיסק — שתי החלופות נדחו במפורש:
 *   - `.opencode/plugins/` ב-cwd: ה-cwd שייך למשתמש, זה הפרויקט שלו. אסור לנו
 *     לדחוף לתוכו תיקייה סמויה.
 *   - `~/.config/opencode/plugins/`: היה חל **גם** על opencode הרגיל בטרמינל של
 *     המשתמש, מחוץ לאפליקציה — פלט בלי emoji ובלי markdown בעבודה רגילה שלו.
 * ה-env var מועבר רק ל-sub-process שאנחנו מולידים, ולכן אינו דולף החוצה.
 */
export function buildOpencodeConfigContent(existingEnv: string | undefined): string {
  // קובץ הפלאגין נמצא במיקום קבוע ביחס לקובץ מקור זה.
  // פיתוח: packages/backend/plugins/prompt-injector.ts
  // import.meta.dirname = packages/backend/src → עלה רמה אחת לשורש ה-backend,
  // ואז לתוך plugins/.
  // Binary: extract embedded plugin from $bunfs to ~/.config/drive-coding/plugins/.
  // Dev: use local plugins/ path (unchanged behaviour).
  const pluginPath = isBinary()
    ? ensurePluginExtracted()
    : path.resolve(import.meta.dirname, "../plugins/prompt-injector.ts")
  const pluginUrl = pathToFileURL(pluginPath).href

  // ממזג עם קונפיגורציה קיימת אם קיימת (משמר פלאגינים/הגדרות של המשתמש).
  const config = existingEnv?.trim() ? (JSON.parse(existingEnv) as Record<string, unknown>) : {}

  // `plugin` יכול להיות: undefined, מחרוזת יחידה (קיצור דרך לפלאגין יחיד),
  // או מערך של מחרוזות (string-only — opencode 1.2.27 לא מקבל tuple).
  // רשומות tuple קיימות (מקונפיג ישן) — נסנן ונשמור רק את ה-url שלהן.
  let existingPlugins: PluginEntry[] = []
  if (Array.isArray(config.plugin)) {
    existingPlugins = (config.plugin as unknown[]).map((p) =>
      Array.isArray(p) ? String(p[0]) : String(p),
    )
  } else if (typeof config.plugin === "string") {
    existingPlugins = [config.plugin]
  }

  // הרשומה שלנו: string בלבד (string-plugin format שopencode 1.2.27 דורש).
  // הטקסט מועבר דרך env var PROMPT_INJECTOR_TEXT (bridge-manager מזריק ל-childEnv).
  const ourEntry: PluginEntry = pluginUrl

  // הסרת כפילויות לפי URL.
  const filtered = existingPlugins.filter((p) => p !== pluginUrl)
  filtered.push(ourEntry)

  return JSON.stringify({
    ...config,
    $schema: (config.$schema as string | undefined) ?? "https://opencode.ai/config.json",
    plugin: filtered,
  })
}
