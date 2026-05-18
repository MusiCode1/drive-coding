/**
 * sessions-cache.ts — localStorage cache for ACP session lists per cwd.
 *
 * TTL: 15 minutes. Keys are cwd paths.
 * Pattern mirrors playback-storage.ts.
 *
 * Key: "voice-acp:sessions:<cwd>"
 */

import type { SessionInfo } from "$lib/api/sessions-ws"

const KEY_PREFIX = "voice-acp:sessions:"
const TTL_MS = 15 * 60 * 1_000

type CacheEntry = {
  sessions: SessionInfo[]
  savedAt: number
}

/** Persist sessions for cwd, resetting the TTL clock. */
export function saveCachedSessions(cwd: string, sessions: SessionInfo[]): void {
  try {
    const entry: CacheEntry = { sessions, savedAt: Date.now() }
    localStorage.setItem(KEY_PREFIX + cwd, JSON.stringify(entry))
  } catch {
    // localStorage unavailable or quota exceeded — ignore
  }
}

/** Return cached sessions for cwd, or null if missing/expired. */
export function loadCachedSessions(cwd: string): SessionInfo[] | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + cwd)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    if (Date.now() - entry.savedAt > TTL_MS) {
      localStorage.removeItem(KEY_PREFIX + cwd)
      return null
    }
    return entry.sessions
  } catch {
    return null
  }
}

/** Immediately remove the cache entry for cwd. */
export function clearCachedSessions(cwd: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + cwd)
  } catch {
    // ignore
  }
}
