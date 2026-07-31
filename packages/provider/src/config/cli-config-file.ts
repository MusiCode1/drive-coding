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
  displayName?: string
  logo?: string
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

  // displayName: string
  if ("displayName" in obj) {
    if (typeof obj["displayName"] === "string") {
      result.displayName = obj["displayName"]
    } else {
      console.warn(
        `[cli-config-file] override["${kind}"].displayName must be a string — skipping field`,
      )
    }
  }

  // logo: string
  if ("logo" in obj) {
    if (typeof obj["logo"] === "string") {
      result.logo = obj["logo"]
    } else {
      console.warn(`[cli-config-file] override["${kind}"].logo must be a string — skipping field`)
    }
  }

  return result
}

// memoization — מוחזק ברמת המודול
let _cached: CliSpecsOverride | null = null

/**
 * טוען ומפענח את קובץ ה-override.
 * - CLI_SPECS_JSON env: inline JSON, ממוזג מעל קובץ cli-specs.jsonc (per-key; inline-JSON גובר).
 * - קובץ לא קיים → {} (אין override, התנהגות היום). בלי warning.
 * - JSON/JSONC שבור → {} + warning (לא קורס).
 * - תקין → מחזיר את ה-map.
 * memoized — נקרא פעם אחת לכל תהליך (lazy).
 */
export function loadCliSpecsOverride(env?: NodeJS.ProcessEnv): CliSpecsOverride {
  // אפשר לדרוס את ה-cache בטסטים דרך vi.resetModules()
  if (_cached !== null) return _cached

  const e = env ?? process.env

  // --- Branch 1: CLI_SPECS_JSON (inline — net-new, from unified config) ---
  // inline-JSON גובר per-key על קובץ (הוא מגיע משכבת flag/env, שגוברת).
  const inlineSpecs: CliSpecsOverride = {}
  const cliSpecsJson = e.CLI_SPECS_JSON
  if (cliSpecsJson) {
    let inlineParsed: unknown
    try {
      inlineParsed = JSON.parse(cliSpecsJson)
    } catch {
      console.warn("[cli-config-file] CLI_SPECS_JSON is not valid JSON — ignoring")
      inlineParsed = null
    }
    if (inlineParsed !== null && typeof inlineParsed === "object" && !Array.isArray(inlineParsed)) {
      const map = inlineParsed as Record<string, unknown>
      for (const [kind, value] of Object.entries(map)) {
        inlineSpecs[kind] = validateOverride(kind, value)
      }
    } else if (inlineParsed !== null) {
      console.warn("[cli-config-file] CLI_SPECS_JSON must be a JSON object — ignoring")
    }
  }

  // --- Branch 2: cli-specs.jsonc file (existing behaviour) ---
  const filePath = resolveCliSpecsPath(env)

  const fileSpecs: CliSpecsOverride = {}

  if (fs.existsSync(filePath)) {
    let raw: string
    try {
      raw = fs.readFileSync(filePath, "utf8")
    } catch (err) {
      console.warn(`[cli-config-file] failed to read ${filePath}:`, err)
      raw = ""
    }

    if (raw) {
      let parsed: unknown
      try {
        const stripped = stripJsoncComments(raw)
        parsed = JSON.parse(stripped)
      } catch (err) {
        console.warn(`[cli-config-file] parse error in ${filePath}:`, err)
        parsed = null
      }

      if (parsed !== null) {
        if (typeof parsed !== "object" || Array.isArray(parsed)) {
          console.warn(`[cli-config-file] ${filePath} must be a JSON object at top level`)
        } else {
          const map = parsed as Record<string, unknown>
          for (const [kind, value] of Object.entries(map)) {
            fileSpecs[kind] = validateOverride(kind, value)
          }
        }
      }
    }
  }

  // --- Merge: file layer first, then inline-JSON overlay (inline wins per-key) ---
  const result: CliSpecsOverride = { ...fileSpecs, ...inlineSpecs }

  _cached = result
  return _cached
}
