/**
 * projects-store.svelte.ts — Phase 9.
 *
 * Manages /api/projects + /api/sessions data with memory cache.
 * Refreshed on focus and on explicit load() call.
 */

import type { ProjectRecord, SessionRecord } from "$lib/api/sessions"
import { listProjectSessions, listProjects, listSessions } from "$lib/api/sessions"
import { createLogger } from "$lib/log"

const log = createLogger("fe.api")

export type { ProjectRecord, SessionRecord }

export function createProjectsStore() {
  let sessions = $state<SessionRecord[]>([])
  let projects = $state<ProjectRecord[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)
  let lastLoaded = $state<number>(0)

  /** Load all sessions + projects. Uses memory cache (5s TTL). */
  async function load(force = false): Promise<void> {
    const now = Date.now()
    if (!force && lastLoaded > 0 && now - lastLoaded < 5000) return

    loading = true
    error = null
    log.debug({}, "fetch projects + sessions")
    try {
      const [sess, proj] = await Promise.all([listSessions(), listProjects()])
      // Sort sessions newest-first
      sessions = [...sess].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      projects = proj
      lastLoaded = Date.now()
    } catch (e) {
      log.warn({ err: e }, "fetch failed")
      error = e instanceof Error ? e.message : "טעינה נכשלה"
    } finally {
      loading = false
    }
  }

  /** Load sessions for a specific project. */
  async function loadProjectSessions(cwdHash: string): Promise<SessionRecord[]> {
    try {
      const sess = await listProjectSessions(cwdHash)
      return [...sess].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
    } catch {
      return []
    }
  }

  return {
    get sessions() {
      return sessions
    },
    get projects() {
      return projects
    },
    get loading() {
      return loading
    },
    get error() {
      return error
    },
    load,
    loadProjectSessions,
  }
}
