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
import * as path from "node:path"
import * as os from "node:os"

export interface CliResolveSpec {
  /** Binary name to search for (without extension), e.g. "codex". */
  bin: string
  /** Env var for explicit override, e.g. "CODEX_PATH". Takes precedence over everything. */
  envVar?: string
  /** Per-CLI known locations: full paths or directories. Expanded with ~ and env vars. */
  knownPaths?: string[]
}

/** Returns the full path to the installed binary, or undefined if not found. */
export function resolveCliBinary(spec: CliResolveSpec): string | undefined {
  // 1. env-override
  if (spec.envVar) {
    const envVal = process.env[spec.envVar]
    if (envVal && envVal.length > 0) {
      return envVal
    }
  }

  // Candidate extensions: on Windows check PATHEXT; elsewhere bare binary only.
  const extensions = getCandidateExtensions()

  // 2. PATH scan
  const rawPath = process.env["PATH"] ?? ""
  const dirs = rawPath.split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const found = findBinInDir(dir, spec.bin, extensions)
    if (found) return found
  }

  // 3. pm-global-bins
  const globalDirs = getPmGlobalBinDirs()
  for (const dir of globalDirs) {
    const found = findBinInDir(dir, spec.bin, extensions)
    if (found) return found
  }

  // 4. knownPaths — can be directories or full paths
  if (spec.knownPaths) {
    for (const candidate of spec.knownPaths) {
      const expanded = expandPath(candidate)
      // If it looks like a full path to the binary (ends with bin name or has extension), try directly
      const baseName = path.basename(expanded).toLowerCase()
      const binLower = spec.bin.toLowerCase()
      if (
        baseName === binLower ||
        extensions.some((ext) => baseName === `${binLower}${ext.toLowerCase()}`)
      ) {
        // It's a full path candidate
        if (fs.existsSync(expanded)) return expanded
      } else {
        // Treat as directory
        const found = findBinInDir(expanded, spec.bin, extensions)
        if (found) return found
      }
    }
  }

  return undefined
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the list of extensions to try. On Windows: PATHEXT entries (uppercased).
 * On all platforms: bare empty string always included first.
 */
function getCandidateExtensions(): string[] {
  const exts: string[] = [""] // bare (no extension) — always first
  const pathExt = process.env["PATHEXT"] ?? ""
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
function findBinInDir(
  dir: string,
  bin: string,
  extensions: string[],
): string | undefined {
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
function getPmGlobalBinDirs(): string[] {
  const home = os.homedir()
  const dirs: string[] = [
    // bun global bin
    path.join(home, ".bun", "bin"),
    // npm global bin (via npm_config_prefix or fallback)
    getNpmGlobalBin(),
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
function getNpmGlobalBin(): string {
  const prefix = process.env["npm_config_prefix"]
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
