import path from "node:path"
import { pathToFileURL } from "node:url"

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
 * ראה `docs/audio-friendly-prompt-plan.md` §7 וה-brief של slice-14.
 * Commit 3 של windows-adaptation: tuple → string-plugin (opencode 1.2.27 compat).
 */
export function buildOpencodeConfigContent(
  existingEnv: string | undefined,
): string {
  // קובץ הפלאגין נמצא במיקום קבוע ביחס לקובץ מקור זה.
  // פיתוח: packages/backend/plugins/prompt-injector.ts
  // import.meta.dirname = packages/backend/src → עלה רמה אחת לשורש ה-backend,
  // ואז לתוך plugins/.
  const pluginPath = path.resolve(
    import.meta.dirname,
    "../plugins/prompt-injector.ts",
  )
  const pluginUrl = pathToFileURL(pluginPath).href

  // ממזג עם קונפיגורציה קיימת אם קיימת (משמר פלאגינים/הגדרות של המשתמש).
  const config = existingEnv?.trim()
    ? (JSON.parse(existingEnv) as Record<string, unknown>)
    : {}

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
    $schema:
      (config.$schema as string | undefined) ??
      "https://opencode.ai/config.json",
    plugin: filtered,
  })
}
