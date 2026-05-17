/**
 * isEnabledForNs — checks whether a namespace matches the given CSV pattern.
 *
 * Pattern syntax (comma-separated):
 *   *              — matches all
 *   voice.*        — prefix match: voice, voice.pipeline, voice.pipeline.tts
 *                    but NOT voicemail (must be exact prefix or followed by ".")
 *   voice.pipeline — exact match only (does NOT match voice.pipeline.tts)
 *   -noisy.x       — exclude (stronger than include)
 *
 * Empty/invalid pattern → defaults to "*" (match all).
 */
export function isEnabledForNs(ns: string, pattern: string): boolean {
  if (!ns || !pattern || pattern.trim() === "") return true

  const parts = pattern
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return true

  let included = false
  let excluded = false

  for (const part of parts) {
    if (part.startsWith("-")) {
      const excl = part.slice(1)
      if (matchSingle(ns, excl)) excluded = true
    } else {
      if (matchSingle(ns, part)) included = true
    }
  }

  // "*" alone — include all by default if no explicit include
  const hasAnyInclude = parts.some((p) => !p.startsWith("-"))
  if (!hasAnyInclude) return !excluded

  return included && !excluded
}

function matchSingle(ns: string, pattern: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2)
    // matches exactly the prefix OR the prefix followed by "."
    return ns === prefix || ns.startsWith(`${prefix}.`)
  }
  // exact match
  return ns === pattern
}
