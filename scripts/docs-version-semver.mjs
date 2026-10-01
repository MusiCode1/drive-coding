/** Pure semver helpers for agent-docs check 6 (no dependencies). */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

/**
 * @param {string} v
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseSemver(v) {
  if (typeof v !== "string") return null
  const m = v.trim().match(SEMVER)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1 | null} null if either operand is not semver
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return null
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return 0
}

/** @param {string} docVersion @param {string} docsVersion */
export function docVersionWithinCap(docVersion, docsVersion) {
  const cmp = compareSemver(docVersion, docsVersion)
  if (cmp === null) return { ok: false, reason: "invalid semver" }
  if (cmp > 0) return { ok: false, reason: "above DOCS_VERSION" }
  return { ok: true }
}
