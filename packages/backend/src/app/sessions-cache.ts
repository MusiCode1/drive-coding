/**
 * SessionsCache — in-memory TTL cache for session/list results.
 *
 * Slice 8a: listing sessions via ACP requires spawning a temp bridge
 * (3-5s). This cache avoids repeated spawns on every page refresh.
 * Default TTL: 5 minutes. Keys are cwd strings.
 */

import type { SessionInfo } from "../acp/acp-transport.js"

type CacheEntry = {
  readonly sessions: readonly SessionInfo[]
  readonly cachedAt: number
}

const DEFAULT_TTL_MS = 5 * 60 * 1_000 // 5 minutes

export function createSessionsCache(opts?: { ttlMs?: number }) {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS
  const store = new Map<string, CacheEntry>()

  return {
    /** Returns cached sessions for cwd, or null if missing / expired. */
    get(cwd: string): readonly SessionInfo[] | null {
      const entry = store.get(cwd)
      if (!entry) return null
      if (Date.now() - entry.cachedAt > ttlMs) {
        store.delete(cwd)
        return null
      }
      return entry.sessions
    },

    /** Stores sessions for cwd, resetting the TTL clock. */
    set(cwd: string, sessions: readonly SessionInfo[]): void {
      store.set(cwd, { sessions, cachedAt: Date.now() })
    },

    /** Immediately removes the entry for cwd (e.g. after creating a session). */
    invalidate(cwd: string): void {
      store.delete(cwd)
    },
  }
}

export type SessionsCache = ReturnType<typeof createSessionsCache>
