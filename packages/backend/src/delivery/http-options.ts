import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Hono } from "hono"

/**
 * Returns a curated list of models per CLI, plus a list of project directories
 * to choose from in the New Agent form. Slice 5+ scaffolding — Slice 8 will
 * replace with proper provider catalog UI.
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
    // Prefer common high-quality models first.
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
    // Also include any remaining anthropic/openai/google models, capped.
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
        // Skip non-readable / massive mounts (e.g. user-files rclone).
        if (e.name === "user-files" || e.name === "node_modules") continue
        try {
          statSync(full)
          dirs.push(full)
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
  }
  // Cap at 50 to keep dropdown manageable.
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
    return c.json({ models, projects })
  })
}
