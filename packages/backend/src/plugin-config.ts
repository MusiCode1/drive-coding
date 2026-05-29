import path from "node:path"
import { pathToFileURL } from "node:url"
import { AUDIO_FRIENDLY_PROMPT } from "./prompts/index.js"

/**
 * רשומת פלאגין בקונפיגורציה של opencode — יכולה להיות URL לקובץ בלבד (ללא אפשרויות)
 * או tuple של `[url, options]`. תואם לסוג `Config.plugin` של `@opencode-ai/plugin`.
 */
type PluginEntry = string | [string, Record<string, unknown>]

/**
 * בונה OPENCODE_CONFIG_CONTENT להפעלת opencode עם הפלאגין הכללי
 * `prompt-injector` טעון, ומוגדר עם טקסט ה-audio-friendly prompt.
 * ממזג עם OPENCODE_CONFIG_CONTENT הקיים של המשתמש, אם ישנו.
 *
 * ראה `docs/audio-friendly-prompt-plan.md` §7 וה-brief של slice-14
 * עבור העיצוב.
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
  // או מערך של רשומות (כל אחת מחרוזת או tuple של [url, options]).
  let existingPlugins: PluginEntry[] = []
  if (Array.isArray(config.plugin)) {
    existingPlugins = [...(config.plugin as PluginEntry[])]
  } else if (typeof config.plugin === "string") {
    existingPlugins = [config.plugin]
  }

  // הרשומה שלנו: tuple כדי שנוכל להעביר את טקסט הפרומפט דרך האפשרויות.
  // דיבאג אופציונלי: אם המשתנה PROMPT_INJECTOR_DEBUG_PATH מוגדר, הפלאגין
  // יפלוט את מערך ה-system-prompt הסופי (JSON) לנתיב הזה בכל קריאה
  // ל-chat. שימושי לאימות ההזרקה מקצה לקצה.
  const debugWritePath = process.env.PROMPT_INJECTOR_DEBUG_PATH
  const ourOptions: Record<string, unknown> = { text: AUDIO_FRIENDLY_PROMPT }
  if (debugWritePath) ourOptions.debugWritePath = debugWritePath
  const ourEntry: PluginEntry = [pluginUrl, ourOptions]

  // הסרת כפילויות לפי URL — מטפל גם ברשומות מחרוזת וגם ברשומות tuple.
  const filtered = existingPlugins.filter((p) =>
    Array.isArray(p) ? p[0] !== pluginUrl : p !== pluginUrl,
  )
  filtered.push(ourEntry)

  return JSON.stringify({
    ...config,
    $schema:
      (config.$schema as string | undefined) ??
      "https://opencode.ai/config.json",
    plugin: filtered,
  })
}
