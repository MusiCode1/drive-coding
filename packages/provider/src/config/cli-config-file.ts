/**
 * cli-config-file.ts — טעינת קובץ JSONC חיצוני שדורס/מרחיב CLI_SPECS.
 *
 * הקובץ (ברירת-מחדל: ~/.config/drive-coding/cli-specs.jsonc) מאפשר לשנות
 * bin/args של CLI קיים, להוסיף CLI חדש, ולציין unsetEnv/setEnv פר-CLI.
 *
 * אין קובץ → {} (אין override, התנהגות כמו היום).
 * JSON שבור → {} + warning (לא קורס).
 * memoized — נקרא פעם אחת לכל תהליך (lazy).
 */

import * as fs from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { CliSpec } from "@drive-coding/core"

/** ערך override — כל השדות אופציונליים (merge חלקי לתוך spec קיים). */
export type CliSpecOverride = Partial<CliSpec>

/** מפת override: cliKind → override. כולל גם CLIs חדשים (מפתח שלא ב-CLI_SPECS). */
export type CliSpecsOverride = Record<string, CliSpecOverride>

/**
 * נתיב ברירת-המחדל לקובץ ה-override.
 * env CLI_SPECS_FILE דורס. אחרת ~/.config/drive-coding/cli-specs.jsonc.
 */
export function resolveCliSpecsPath(env?: NodeJS.ProcessEnv): string {
  const e = env ?? process.env
  return e.CLI_SPECS_FILE ?? join(homedir(), ".config", "drive-coding", "cli-specs.jsonc")
}

/**
 * מסיר הערות JSONC מטקסט:
 * - שורות שה-trim שלהן מתחיל ב-//
 * - בלוקים בין /* ל-*\/
 *
 * גישה שמרנית: לא מנסה לזהות // בתוך מחרוזות (edge case מסוכן).
 * הנחה: קובצי קונפיג לא יכילו // בתוך ערכי-מחרוזת.
 */
function stripJsoncComments(text: string): string {
  // הסרת בלוקי /* ... */
  let result = text.replace(/\/\*[\s\S]*?\*\//g, "")
  // הסרת שורות שמתחילות ב-// (אחרי whitespace)
  result = result
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n")
  return result
}

/** מבנה ניתן-לכתיבה לבנייה הדרגתית של override (לפני הפיכתו ל-readonly). */
type MutableOverride = {
  bin?: string
  args?: string[]
  supportsModelFlag?: boolean
  unsetEnv?: string[]
  setEnv?: Record<string, string>
}

/**
 * מאמת ומנקה ערך override של spec אחד.
 * שדות לא תקינים מדולגים עם warning, השאר נשמר.
 */
function validateOverride(kind: string, raw: unknown): CliSpecOverride {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    console.warn(`[cli-config-file] override for "${kind}" must be an object — skipping`)
    return {}
  }

  const obj = raw as Record<string, unknown>
  const result: MutableOverride = {}

  // bin: string
  if ("bin" in obj) {
    if (typeof obj["bin"] === "string") {
      result.bin = obj["bin"]
    } else {
      console.warn(`[cli-config-file] override["${kind}"].bin must be a string — skipping field`)
    }
  }

  // args: string[]
  if ("args" in obj) {
    const args = obj["args"]
    if (Array.isArray(args) && args.every((a) => typeof a === "string")) {
      result.args = args as string[]
    } else {
      console.warn(`[cli-config-file] override["${kind}"].args must be string[] — skipping field`)
    }
  }

  // supportsModelFlag: boolean
  if ("supportsModelFlag" in obj) {
    if (typeof obj["supportsModelFlag"] === "boolean") {
      result.supportsModelFlag = obj["supportsModelFlag"]
    } else {
      console.warn(
        `[cli-config-file] override["${kind}"].supportsModelFlag must be boolean — skipping field`,
      )
    }
  }

  // unsetEnv: string[]
  if ("unsetEnv" in obj) {
    const unsetEnv = obj["unsetEnv"]
    if (Array.isArray(unsetEnv) && unsetEnv.every((v) => typeof v === "string")) {
      result.unsetEnv = unsetEnv as string[]
    } else {
      console.warn(
        `[cli-config-file] override["${kind}"].unsetEnv must be string[] — skipping field`,
      )
    }
  }

  // setEnv: Record<string, string>
  if ("setEnv" in obj) {
    const setEnv = obj["setEnv"]
    if (
      typeof setEnv === "object" &&
      setEnv !== null &&
      !Array.isArray(setEnv) &&
      Object.values(setEnv).every((v) => typeof v === "string")
    ) {
      result.setEnv = setEnv as Record<string, string>
    } else {
      console.warn(
        `[cli-config-file] override["${kind}"].setEnv must be Record<string,string> — skipping field`,
      )
    }
  }

  return result
}

// memoization — מוחזק ברמת המודול
let _cached: CliSpecsOverride | null = null

/**
 * טוען ומפענח את קובץ ה-override.
 * - קובץ לא קיים → {} (אין override, התנהגות היום). בלי warning.
 * - JSON/JSONC שבור → {} + warning (לא קורס).
 * - תקין → מחזיר את ה-map.
 * memoized — נקרא פעם אחת לכל תהליך (lazy).
 */
export function loadCliSpecsOverride(env?: NodeJS.ProcessEnv): CliSpecsOverride {
  // אפשר לדרוס את ה-cache בטסטים דרך vi.resetModules()
  if (_cached !== null) return _cached

  const filePath = resolveCliSpecsPath(env)

  // קובץ לא קיים — תקין, אין override
  if (!fs.existsSync(filePath)) {
    _cached = {}
    return _cached
  }

  let raw: string
  try {
    raw = fs.readFileSync(filePath, "utf8")
  } catch (err) {
    console.warn(`[cli-config-file] failed to read ${filePath}:`, err)
    _cached = {}
    return _cached
  }

  let parsed: unknown
  try {
    const stripped = stripJsoncComments(raw)
    parsed = JSON.parse(stripped)
  } catch (err) {
    console.warn(`[cli-config-file] parse error in ${filePath}:`, err)
    _cached = {}
    return _cached
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn(`[cli-config-file] ${filePath} must be a JSON object at top level`)
    _cached = {}
    return _cached
  }

  const map = parsed as Record<string, unknown>
  const result: CliSpecsOverride = {}

  for (const [kind, value] of Object.entries(map)) {
    result[kind] = validateOverride(kind, value)
  }

  _cached = result
  return _cached
}
