/**
 * sessions.ts — API wrappers for /api/projects (Slice 8a, updated fe-fetch-sessions).
 *
 * /api/sessions and /api/projects/:cwdHash/sessions have been removed from BE.
 * Session listing now happens via ACP WebSocket — see sessions-ws.ts.
 */

import { cwdToHash } from "@drive-coding/core/cwd-hash"

export type SessionRecord = {
  sessionId: string
  cwd: string
  /** SHA-256(cwd) as base64url — computed client-side after load. */
  cwdHash: string
  title: string
  updatedAt: string
  cliKind: string
}

export type ProjectRecord = {
  /** SHA-256(cwd) as base64url — computed by listProjects(). */
  cwdHash: string
  cwd: string
  /** CLI kind used for this project (opencode, gemini, etc.). */
  kind: string
  lastSeen: string
  /** Last known ACP session ID — recorded by /api/agents/:id/session-attached. */
  lastSessionId?: string
}

const API_BASE = ""

export async function listProjects(): Promise<ProjectRecord[]> {
  const res = await fetch(`${API_BASE}/api/projects`)
  if (!res.ok) throw new Error(`listProjects failed: ${res.status}`)
  const data = (await res.json()) as { projects?: Omit<ProjectRecord, "cwdHash">[] }
  const raw = data.projects ?? []
  // cwdHash is not in the API response — compute it client-side (SHA-256(cwd), base64url)
  return Promise.all(raw.map(async (p) => ({ ...p, cwdHash: await cwdToHash(p.cwd) })))
}
