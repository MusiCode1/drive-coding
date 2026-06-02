import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Hono } from "hono"

/**
 * מחזיר רשימה מנופה של מודלים לכל CLI, בתוספת רשימת ספריות פרויקטים
 * לבחירה בטופס סוכן חדש. Scaffolding עבור Slice 5 ומעלה — Slice 8
 * יחליף את זה ב-UI קטלוג ספקים אמיתי.
 */

const MODEL_FALLBACKS = {
  opencode: [
    "anthropic/claude-opus-4-7",
    "anthropic/claude-opus-4-6",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-sonnet-4-5",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-5",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
  ],
  claude: ["claude-sonnet-4-5", "claude-opus-4-7", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-flash-latest"],
  codex: ["gpt-5", "gpt-5-mini"],
} as const satisfies Record<string, readonly string[]>

function listOpencodeModels(): string[] {
  try {
    const out = execFileSync("opencode", ["models"], {
      encoding: "utf8",
      timeout: 5000,
    })
    const lines = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
    // מעדיף מודלים נפוצים באיכות גבוהה קודם.
    const preferredPrefixes = [
      "anthropic/claude-opus-4-7",
      "anthropic/claude-opus-4-6",
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-haiku-4-5",
      "openai/gpt-5",
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
    ]
    const picked: string[] = []
    for (const pref of preferredPrefixes) {
      const exact = lines.find((l) => l === pref)
      if (exact) picked.push(exact)
    }
    // כולל גם את שאר המודלים של anthropic/openai/google, עם הגבלת כמות.
    const remaining = lines
      .filter(
        (l) =>
          !picked.includes(l) &&
          (l.startsWith("anthropic/") || l.startsWith("openai/") || l.startsWith("google/")),
      )
      .slice(0, 20)
    return [...picked, ...remaining]
  } catch {
    return [...MODEL_FALLBACKS.opencode]
  }
}

function listProjectDirs(): string[] {
  const home = os.homedir()
  const candidates = [path.join(home, "projects"), home, "/tmp"]
  const dirs: string[] = []
  for (const root of candidates) {
    if (!existsSync(root)) continue
    try {
      const entries = readdirSync(root, { withFileTypes: true })
      for (const e of entries) {
        if (!e.isDirectory()) continue
        if (e.name.startsWith(".")) continue
        const full = path.join(root, e.name)
        // מדלג על mounts לא קריאים / ענקיים (למשל rclone של user-files).
        if (e.name === "user-files" || e.name === "node_modules") continue
        try {
          statSync(full)
          dirs.push(full)
        } catch {
          // דלג
        }
      }
    } catch {
      // דלג
    }
  }
  // מגביל ל-50 כדי לשמור על dropdown סביר.
  return dirs.slice(0, 50)
}

export function registerHttpOptions(app: Hono): void {
  app.get("/api/options", (c) => {
    const models: Record<string, readonly string[]> = {
      opencode: listOpencodeModels(),
      claude: MODEL_FALLBACKS.claude,
      gemini: MODEL_FALLBACKS.gemini,
      codex: MODEL_FALLBACKS.codex,
    }
    const projects = listProjectDirs()
    // Slice 24: homeDir מאפשר ל-FE לאכלס את שדה ה-cwd ברירת מחדל (נייד, לא מקובע)
    const homeDir = os.homedir()
    return c.json({ models, projects, homeDir })
  })
}
