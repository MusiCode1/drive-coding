/**
 * deep-link-cwd.ts — סיווג cwd מ-query של deep-link /chat/<cli>/new.
 *
 * slice: deep-link-new-session (Commit 0)
 * אינו נוגע ברשת; joinHomeDir מצרף יחסי ל-homeDir שהקורא מביא.
 */

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/

export type DeepLinkCwd =
  | { kind: "empty" }
  | { kind: "absolute"; cwd: string }
  | { kind: "relative"; relative: string }

function isAbsolutePath(trimmed: string): boolean {
  return (
    trimmed.startsWith("/") ||
    WINDOWS_DRIVE_RE.test(trimmed) ||
    trimmed.startsWith("\\\\")
  )
}

/** מסווג את ה-cwd הגולמי מה-query. אינו נוגע ברשת ואינו מצרף homeDir. */
export function classifyDeepLinkCwd(raw: string | null): DeepLinkCwd {
  if (raw === null || raw.trim() === "") {
    return { kind: "empty" }
  }
  const trimmed = raw.trim()
  if (isAbsolutePath(trimmed)) {
    return { kind: "absolute", cwd: trimmed }
  }
  return { kind: "relative", relative: trimmed }
}

/** מצרף נתיב יחסי לתיקיית-בית; מנרמל אלכסון סופי ב-homeDir. */
export function joinHomeDir(homeDir: string, relative: string): string {
  const base = homeDir.endsWith("/") ? homeDir.slice(0, -1) : homeDir
  return `${base}/${relative}`
}
