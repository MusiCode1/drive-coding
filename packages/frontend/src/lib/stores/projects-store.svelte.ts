/**
 * projects-store.svelte.ts — Phase 9 (updated fe-fetch-sessions).
 *
 * Manages /api/projects data with memory cache.
 * Refreshed on focus and on explicit load() call.
 *
 * Session listing has been removed from this store — it now happens
 * per-page via ACP WebSocket (see sessions-ws.ts + sessions/[cwdHash] route).
 */

import type { ProjectRecord } from "$lib/api/sessions"
import { listProjects } from "$lib/api/sessions"
import { createLogger } from "$lib/log"

const log = createLogger("fe.api")

export type { ProjectRecord }

export function createProjectsStore() {
  let projects = $state<ProjectRecord[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)
  let lastLoaded = $state<number>(0)

  /** Load projects. Uses memory cache (5s TTL). */
  async function load(force = false): Promise<void> {
    const now = Date.now()
    if (!force && lastLoaded > 0 && now - lastLoaded < 5000) return

    loading = true
    error = null
    log.debug({}, "fetch projects")
    try {
      projects = await listProjects()
      lastLoaded = Date.now()
    } catch (e) {
      log.warn({ err: e }, "fetch failed")
      error = e instanceof Error ? e.message : "טעינה נכשלה"
    } finally {
      loading = false
    }
  }

  return {
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
  }
}
