/**
 * cwd-validate.ts — pure validation of a working-directory path string.
 *
 * Returns Result<string, CwdValidationError> (neverthrow).
 * On Ok: the normalised cwd (trailing slash stripped, except root "/").
 * On Err: a tagged union describing exactly what is wrong.
 *
 * Rules enforced:
 *   - non-empty
 *   - absolute (starts with "/")
 *   - no NUL bytes (would truncate C-string in spawn syscall)
 *   - no control characters U+0001–U+001F (log injection, path corruption)
 *   - no percent-encoded sequences %XX (artifact of URL double-encoding)
 *   - length ≤ 4096 (Linux PATH_MAX)
 *
 * Deliberately NOT enforced:
 *   - path existence (IO — belongs in shell, not core)
 *   - path traversal (resolve/realpath — IO)
 *   - % characters not followed by two hex digits (legitimate in filenames)
 */

import { err, ok, type Result } from "neverthrow"

// ─── Error types ─────────────────────────────────────────────────────────────

export type CwdValidationError =
  | { kind: "empty" }
  | { kind: "not_absolute"; got: string }
  | { kind: "contains_null" }
  | { kind: "contains_percent_encoding"; match: string }
  | { kind: "contains_control_chars"; codepoint: number }
  | { kind: "too_long"; length: number }

// ─── Constants ────────────────────────────────────────────────────────────────

/** Linux PATH_MAX */
const MAX_LENGTH = 4096

/** Matches URL percent-encoded sequences: % followed by exactly two hex digits */
const PERCENT_ENCODED_RE = /%[0-9a-fA-F]{2}/

/** Matches ASCII control characters U+0001–U+001F (excludes NUL which is checked first) */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control chars
const CONTROL_CHAR_RE = /[\u0001-\u001f]/

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Validate and normalise a cwd path string.
 *
 * @param cwd - raw string from user input or URL parameter
 * @returns Ok(normalisedCwd) | Err(CwdValidationError)
 */
export function validateCwd(cwd: string): Result<string, CwdValidationError> {
  // 1. Empty
  if (cwd.length === 0) {
    return err({ kind: "empty" })
  }

  // 2. Too long (check before further processing)
  if (cwd.length > MAX_LENGTH) {
    return err({ kind: "too_long", length: cwd.length })
  }

  // 3. Absolute path required
  if (!cwd.startsWith("/")) {
    return err({ kind: "not_absolute", got: cwd })
  }

  // 4. NUL byte
  if (cwd.includes("\u0000")) {
    return err({ kind: "contains_null" })
  }

  // 5. Percent-encoded sequences (%XX) — artifact of URL double-encoding
  const percentMatch = cwd.match(PERCENT_ENCODED_RE)
  if (percentMatch) {
    return err({ kind: "contains_percent_encoding", match: percentMatch[0] })
  }

  // 6. Control characters U+0001–U+001F
  const controlMatch = cwd.match(CONTROL_CHAR_RE)
  if (controlMatch) {
    return err({
      kind: "contains_control_chars",
      codepoint: controlMatch[0].codePointAt(0) ?? 0,
    })
  }

  // 7. Normalise: strip trailing slash, except root "/"
  const normalised = cwd.length > 1 && cwd.endsWith("/") ? cwd.slice(0, -1) : cwd

  return ok(normalised)
}
