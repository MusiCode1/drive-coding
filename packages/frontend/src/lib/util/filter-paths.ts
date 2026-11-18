/** Minimal shape for path filtering — works with RecentProject or test fixtures. */
export type PathEntry = { cwd: string }

/**
 * Filters recent projects for the cwd combo dropdown.
 * Empty query → first `limit` items (input order preserved).
 * Non-empty query → case-insensitive substring match on full cwd, no limit.
 */
export function filterPaths<T extends PathEntry>(
  projects: readonly T[],
  query: string,
  limit: number,
): T[] {
  const q = query.trim()
  if (q === "") {
    return projects.slice(0, limit)
  }
  const lower = q.toLowerCase()
  return projects.filter((p) => p.cwd.toLowerCase().includes(lower))
}
