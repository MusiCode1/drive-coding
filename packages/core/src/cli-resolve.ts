/**
 * cli-resolve.ts — generic CLI binary location resolver.
 *
 * Pure + synchronous. Uses fs.existsSync + env only. No spawn (no which/where).
 * Cross-platform: handles PATHEXT on Windows for executable extensions.
 *
 * Resolution order (first hit wins):
 *   1. envVar override (explicit, e.g. CODEX_PATH)
 *   2. PATH scan (with PATHEXT extensions on Windows)
 *   3. pm-global-bins: ~/.bun/bin, npm global prefix, ~/.local/bin, /usr/local/bin, /opt/homebrew/bin
 *   4. spec.knownPaths: per-CLI known dirs or full paths
 *   5. undefined (not found)
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export interface CliResolveSpec {
  /** Binary name to search for (without extension), e.g. "codex". */
  bin: string
  /** Env var for explicit override, e.g. "CODEX_PATH". Takes precedence over everything. */
  envVar?: string
  /** Per-CLI known locations: full paths or directories. Expanded with ~ and env vars. */
  knownPaths?: string[]
  /**
   * שמות-חלופה לאותו CLI (למשל cursor: agent → cursor-agent).
   * נבדקים **רק אחרי** ש-bin לא נמצא באף מיקום. הסדר = סדר-עדיפות.
   */
  fallbackBins?: readonly string[]
}

/** Returns the full path to the installed binary, or undefined if not found. */
export function resolveCliBinary(
  spec: CliResolveSpec,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  // 1. env-override — נבדק פעם אחת בלבד, לפני הכל. דריסה מפורשת של המשתמשת — לא שם,
  //    ולכן לא חוזרת על עצמה לכל fallback.
  if (spec.envVar) {
    const envVal = env[spec.envVar]
    if (envVal && envVal.length > 0) {
      return envVal
    }
  }

  // Candidate extensions: on Windows check PATHEXT; elsewhere bare binary only.
  const extensions = getCandidateExtensions(env)

  // name-major: נסה את spec.bin בכל המיקומים, ורק אם לא נמצא בכלל — כל fallback
  // בכל המיקומים, בסדר-הופעתו. לא per-location (השם הראשי מנצח גם אם חלופה יושבת
  // מוקדם יותר ב-PATH).
  const names = [spec.bin, ...(spec.fallbackBins ?? [])]
  for (const name of names) {
    const found = searchBinAllLocations(name, extensions, env, spec.knownPaths)
    if (found) return found
  }

  return undefined
}

/** Searches every location (except envVar) for a single binary name. */
function searchBinAllLocations(
  bin: string,
  extensions: string[],
  env: NodeJS.ProcessEnv,
  knownPaths: string[] | undefined,
): string | undefined {
  // נתיב מוחלט/יחסי-מפורש ב-bin: אין מה לחפש — בדוק קיום ישירות.
  // (path.join(dir, "/abs") מייצר זבל, ולכן סריקת ה-PATH לעולם לא תמצא נתיב מוחלט.)
  if (path.isAbsolute(bin) || bin.startsWith("./") || bin.startsWith("../")) {
    if (fs.existsSync(bin)) return bin
    // Windows: נתיב מוחלט **ללא סיומת** — נסה את מועמדי PATHEXT (.cmd/.exe/…),
    // בדיוק כמו סריקת ה-PATH.
    // (הדוגמה ל-cursor ב-deploy/cli-specs.jsonc כבר נושאת .cmd ולכן נתפסת בשורה שמעל;
    //  הענף הזה מכסה את מי שיכתוב נתיב ללא סיומת — נפוץ כשמעתיקים נתיב מ-PowerShell.)
    for (const ext of extensions) {
      if (ext && fs.existsSync(bin + ext)) return bin + ext
    }
    return undefined
  }

  // 2. PATH scan
  const rawPath = env["PATH"] ?? ""
  const dirs = rawPath.split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const found = findBinInDir(dir, bin, extensions)
    if (found) return found
  }

  // 3. pm-global-bins
  const globalDirs = getPmGlobalBinDirs(env)
  for (const dir of globalDirs) {
    const found = findBinInDir(dir, bin, extensions)
    if (found) return found
  }

  // 4. knownPaths — can be directories or full paths
  if (knownPaths) {
    for (const candidate of knownPaths) {
      const expanded = expandPath(candidate)
      // If it looks like a full path to the binary (ends with bin name or has extension), try directly
      const baseName = path.basename(expanded).toLowerCase()
      const binLower = bin.toLowerCase()
      if (
        baseName === binLower ||
        extensions.some((ext) => baseName === `${binLower}${ext.toLowerCase()}`)
      ) {
        // It's a full path candidate
        if (fs.existsSync(expanded)) return expanded
      } else {
        // Treat as directory
        const found = findBinInDir(expanded, bin, extensions)
        if (found) return found
      }
    }
  }

  return undefined
}

// ─── resolveCliBinaryCached — lazy, positive-only, caller-owned cache ────────────
//
// AGENTS.md: "packages/core/ — pure logic, no IO" · "Functional core / imperative
// shell". מטמון הוא state, ולכן הוא **לא** יושב כאן ברמת-המודול — הקורא מחזיק אותו
// ומעביר אותו. הקליפה (provider/backend) היא שמחזיקה את המופע.
// זה גם מייתר `invalidateBinaryCache()`: מי שמחזיק את ה-Map מנקה אותו בעצמו.

/** מטמון פתירת-בינאריים בבעלות הקורא. מפתח: ר' `buildCacheKey`. */
export type BinaryCache = Map<string, string>

/**
 * מפתח המטמון חייב לכלול כל מה שה-resolver קורא, אחרת יוחזר נתיב שגוי כשהסביבה
 * משתנה: bin · envVar · env[envVar] · fallbackBins · knownPaths · env.PATH ·
 * env.PATHEXT · env.npm_config_prefix (r2) · os.homedir() (r3 — getPmGlobalBinDirs
 * גוזר ממנו את כל תיקיות-החיפוש שלו).
 */
function buildCacheKey(spec: CliResolveSpec, env: NodeJS.ProcessEnv): string {
  const envVarValue = spec.envVar ? (env[spec.envVar] ?? "") : ""
  return [
    spec.bin,
    spec.envVar ?? "",
    envVarValue,
    (spec.fallbackBins ?? []).join(","),
    (spec.knownPaths ?? []).join(","),
    env["PATH"] ?? "",
    env["PATHEXT"] ?? "",
    env["npm_config_prefix"] ?? "",
    os.homedir(),
  ].join(" ")
}

/**
 * עטיפה ממוטמנת ל-resolveCliBinary. חיוביים בלבד — "לא נמצא" לעולם לא נשמר.
 * על hit: מאמת existsSync; אם הנתיב נעלם, מוחק את הרשומה ופותר מחדש.
 * אסור realpath — הנתיב נשמר כפי שהוחזר (ר' §0 — תיקיית-גרסה של cursor).
 */
export function resolveCliBinaryCached(
  spec: CliResolveSpec,
  // env: ברירת-מחדל זהה ל-resolveCliBinary — לא זה מה שתוקן כאן.
  env: NodeJS.ProcessEnv = process.env,
  // cache: **חובה, בלי ברירת-מחדל.** מטמון הוא state ולכן בבעלות הקורא.
  // ברירת-מחדל `new Map()` הייתה מטמון-ריק בכל קריאה — פונקציה בשם "Cached"
  // שאינה ממטמנת דבר, בשקט. עדיף לכפות על הקורא להצהיר מי הבעלים.
  cache: BinaryCache,
): string | undefined {
  const key = buildCacheKey(spec, env)
  const cached = cache.get(key)
  if (cached !== undefined) {
    if (fs.existsSync(cached)) return cached
    cache.delete(key)
  }

  const resolved = resolveCliBinary(spec, env)
  if (resolved !== undefined) {
    cache.set(key, resolved)
  }
  return resolved
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the list of extensions to try. On Windows: PATHEXT entries (uppercased).
 * On all platforms: bare empty string always included first.
 */
function getCandidateExtensions(env: NodeJS.ProcessEnv): string[] {
  const exts: string[] = [""] // bare (no extension) — always first
  const pathExt = env["PATHEXT"] ?? ""
  if (pathExt.length > 0) {
    for (const ext of pathExt.split(";")) {
      const trimmed = ext.trim()
      if (trimmed.length > 0 && trimmed !== "") {
        exts.push(trimmed.toUpperCase())
      }
    }
  }
  return exts
}

/** Check `<dir>/<bin><ext>` for each extension. Return first existing path. */
function findBinInDir(dir: string, bin: string, extensions: string[]): string | undefined {
  for (const ext of extensions) {
    const candidate = path.join(dir, `${bin}${ext}`)
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Returns common package-manager global bin directories.
 * All paths are best-effort; missing dirs are silently skipped (existsSync in caller).
 */
function getPmGlobalBinDirs(env: NodeJS.ProcessEnv): string[] {
  const home = os.homedir()
  const dirs: string[] = [
    // bun global bin
    path.join(home, ".bun", "bin"),
    // npm global bin (via npm_config_prefix or fallback)
    getNpmGlobalBin(env),
    // ~/.local/bin (Linux/Termux user installs)
    path.join(home, ".local", "bin"),
    // /usr/local/bin (Unix standard)
    "/usr/local/bin",
    // Homebrew (macOS Apple Silicon + Intel)
    "/opt/homebrew/bin",
    "/usr/local/opt/bin",
    // Windows common locations
    path.join(home, "AppData", "Local", "Programs", "nodejs"),
    path.join(home, "AppData", "Roaming", "npm"),
  ]
  return dirs.filter((d) => d.length > 0)
}

/** Derive npm global bin directory from npm_config_prefix or OS conventions. */
function getNpmGlobalBin(env: NodeJS.ProcessEnv): string {
  const prefix = env["npm_config_prefix"]
  if (prefix && prefix.length > 0) {
    // On Unix: <prefix>/bin; on Windows: <prefix>
    return process.platform === "win32" ? prefix : path.join(prefix, "bin")
  }
  // Fallback to standard npm global on Unix
  return process.platform === "win32"
    ? path.join(os.homedir(), "AppData", "Roaming", "npm")
    : "/usr/local/bin"
}

/** Expand leading ~ to home directory. Does NOT expand env vars (keep it simple). */
function expandPath(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1))
  }
  return p
}
