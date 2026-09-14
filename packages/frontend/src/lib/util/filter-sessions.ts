import type { SessionInfo } from "$lib/adapters/sessions"

export type FilterSessionsOptions = {
  query: string
  currentCwd: string | null
  currentCwdOnly: boolean
}

/** Strip trailing slashes for cwd equality (root `/` stays as-is). */
export function normalizeCwdForCompare(cwd: string): string {
  if (cwd === "/") return cwd
  const trimmed = cwd.replace(/\/+$/, "")
  return trimmed === "" ? cwd : trimmed
}

function matchesQuery(session: SessionInfo, query: string): boolean {
  const q = query.trim()
  if (q === "") return true
  const title = session.title.trim()
  if (title === "") return false
  return title.toLowerCase().includes(q.toLowerCase())
}

function matchesCwd(
  session: SessionInfo,
  currentCwd: string | null,
  currentCwdOnly: boolean,
): boolean {
  if (!currentCwdOnly) return true
  if (currentCwd === null || currentCwd === "") return false
  return normalizeCwdForCompare(session.cwd) === normalizeCwdForCompare(currentCwd)
}

export function filterSessions(
  sessions: SessionInfo[],
  opts: FilterSessionsOptions,
): SessionInfo[] {
  return sessions.filter(
    (s) => matchesQuery(s, opts.query) && matchesCwd(s, opts.currentCwd, opts.currentCwdOnly),
  )
}
