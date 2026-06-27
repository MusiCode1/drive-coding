/**
 * env-file.ts — pure KEY=VALUE env file parser.
 *
 * Supports:
 *   - KEY=VALUE (basic)
 *   - # comment lines (skipped)
 *   - Empty lines (skipped)
 *   - VALUE with = inside (split on first = only)
 *   - Double/single-quoted values ("…" / '…') — quotes stripped
 *   - Key with surrounding spaces — trimmed
 *   - Lines without = — skipped
 *   - Windows CRLF line endings
 *
 * Pure: does not touch process.env. The caller decides where to apply the result.
 */

export function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {}

  // Normalise line endings (CRLF → LF).
  const lines = text.replace(/\r\n/g, "\n").split("\n")

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Skip empty lines and comments.
    if (line === "" || line.startsWith("#")) continue

    // Find the first '=' — split key and value there.
    const eqIdx = line.indexOf("=")
    if (eqIdx === -1) continue // No '=' → skip.

    const key = line.slice(0, eqIdx).trim()
    if (key === "") continue // Empty key → skip.

    let value = line.slice(eqIdx + 1).trim()

    // Strip enclosing quotes ("…" or '…').
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    result[key] = value
  }

  return result
}
