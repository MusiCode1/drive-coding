/**
 * sessions.ts — API wrappers for /api/projects + /api/sessions (Slice 8a).
 */

export type SessionRecord = {
  sessionId: string
  cwd: string
  /** SHA-256(cwd) as base64url — computed client-side after load, not from API. */
  cwdHash: string
  title: string
  updatedAt: string
  cliKind: string
}

export type ProjectRecord = {
  cwdHash: string
  cwd: string
  lastSeen: string
  sessionCount: number
}

const API_BASE = ""

export async function listSessions(): Promise<SessionRecord[]> {
  const res = await fetch(`${API_BASE}/api/sessions`)
  if (!res.ok) throw new Error(`listSessions failed: ${res.status}`)
  const data = (await res.json()) as { sessions?: SessionRecord[] }
  return data.sessions ?? []
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const res = await fetch(`${API_BASE}/api/projects`)
  if (!res.ok) throw new Error(`listProjects failed: ${res.status}`)
  const data = (await res.json()) as { projects?: ProjectRecord[] }
  return data.projects ?? []
}

export async function listProjectSessions(cwdHash: string): Promise<SessionRecord[]> {
  const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(cwdHash)}/sessions`)
  if (!res.ok) throw new Error(`listProjectSessions failed: ${res.status}`)
  const data = (await res.json()) as { sessions?: SessionRecord[] }
  return data.sessions ?? []
}
