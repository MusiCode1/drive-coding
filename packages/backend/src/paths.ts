import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { getHomeDir } from "./delivery/http-options.js"

/** תיקיית ה-state היציבה: <home>/.config/drive-coding. אחיד פר-OS. */
export function getStateDir(): string {
  return join(getHomeDir(), ".config", "drive-coding")
}

/** מחזיר נתיב תת-תיקייה תחת ה-state dir, ויוצר אותו אם חסר. */
export function ensureStateSubdir(...segments: string[]): string {
  const p = join(getStateDir(), ...segments)
  mkdirSync(p, { recursive: true })
  return p
}
