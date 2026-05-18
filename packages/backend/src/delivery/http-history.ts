/**
 * HTTP endpoints for Slice 8a — Session History
 *
 *   GET  /api/projects                       — list known projects (from registry)
 *   GET  /api/projects/:cwdHash/sessions     — sessions for a project (cache-aside)
 *   GET  /api/sessions                       — union across all cwds (sorted, limited)
 *   GET  /api/recordings/:id                 — serve raw audio bytes
 *   GET  /api/fs/browse?path=                — directory listing (security-guarded)
 *
 * cwdHash = SHA-256(cwd) encoded as base64url (URL-safe, no padding).
 */

import { readdir, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { cwdToHash } from "@drive-coding/core"
import type { Hono } from "hono"
import type { SessionInfo } from "../acp/session-types.js"
import type { ProjectsRegistry } from "../app/projects-registry.js"
import type { RecordingsStore } from "../app/recordings-store.js"
import type { SessionsCache } from "../app/sessions-cache.js"

// ─── /api/projects + /api/sessions ───────────────────────────────────────────

export function registerProjectsHttp(
  app: Hono,
  deps: {
    projectsRegistry: ProjectsRegistry
    sessionsCache: SessionsCache
    /**
     * Called on cache miss to fetch sessions for a cwd.
     * Caller is responsible for spawning + killing a temp bridge.
     * Returns empty array on any error (Gemini fallback pattern).
     */
    fetchSessions: (cwd: string) => Promise<readonly SessionInfo[]>
  },
): void {
  // GET /api/projects
  app.get("/api/projects", async (c) => {
    const projects = await deps.projectsRegistry.getProjects()
    return c.json({ projects })
  })

  // GET /api/projects/:cwdHash/sessions — cache-aside
  app.get("/api/projects/:cwdHash/sessions", async (c) => {
    const cwdHash = c.req.param("cwdHash")

    // Resolve cwdHash → cwd (cwdToHash is async — compute all hashes in parallel)
    const allProjects = await deps.projectsRegistry.getProjects()
    const hashes = await Promise.all(allProjects.map((p) => cwdToHash(p.cwd)))
    const entryIdx = hashes.findIndex((h) => h === cwdHash)
    const entry = entryIdx >= 0 ? allProjects[entryIdx] : undefined
    if (!entry) {
      return c.json({ error: "project not found" }, 404)
    }

    const { cwd } = entry

    // Check cache first
    const cached = deps.sessionsCache.get(cwd)
    if (cached) {
      return c.json({ sessions: cached })
    }

    // Cache miss: fetch and populate cache
    const sessions = await deps.fetchSessions(cwd)
    deps.sessionsCache.set(cwd, sessions)
    return c.json({ sessions })
  })

  // GET /api/sessions — union of all cwds, sorted by updatedAt DESC, limit 50
  app.get("/api/sessions", async (c) => {
    const allProjects = await deps.projectsRegistry.getProjects()

    // Fetch sessions for each cwd (cache-aside per cwd)
    const perCwd = await Promise.all(
      allProjects.map(async (entry): Promise<readonly SessionInfo[]> => {
        const cached = deps.sessionsCache.get(entry.cwd)
        if (cached) return cached
        const sessions = await deps.fetchSessions(entry.cwd)
        deps.sessionsCache.set(entry.cwd, sessions)
        return sessions
      }),
    )

    const unified = perCwd.flat()
    const sorted = [...unified].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    const limited = sorted.slice(0, 50)

    return c.json({ sessions: limited })
  })
}

// ─── /api/recordings/:id ─────────────────────────────────────────────────────

export function registerRecordingsHttp(
  app: Hono,
  deps: { recordingsStore: RecordingsStore },
): void {
  app.get("/api/recordings/:id", async (c) => {
    const id = c.req.param("id")
    const recording = await deps.recordingsStore.get(id)

    if (!recording) {
      return c.json({ error: "recording not found" }, 404)
    }

    return new Response(recording.bytes, {
      status: 200,
      headers: { "Content-Type": recording.mimeType },
    })
  })
}

// ─── POST /api/recordings ─────────────────────────────────────────────────────

/**
 * POST /api/recordings — Upload and persist an audio recording.
 *
 * Slice 10 Phase 1: FE uploads audio in the background in parallel with STT.
 *
 * Body: { audioBase64: string, mimeType: string }
 * Response: { id: string }
 */
export function registerRecordingsPostHttp(
  app: Hono,
  deps: { recordingsStore: RecordingsStore },
): void {
  app.post("/api/recordings", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }

    const { audioBase64, mimeType } = body as Record<string, unknown>

    if (typeof audioBase64 !== "string" || !audioBase64) {
      return c.json({ error: "audioBase64 is required" }, 400)
    }
    if (typeof mimeType !== "string" || !mimeType) {
      return c.json({ error: "mimeType is required" }, 400)
    }

    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(Buffer.from(audioBase64, "base64"))
    } catch {
      return c.json({ error: "invalid base64" }, 400)
    }

    const { id } = await deps.recordingsStore.save(bytes, mimeType)
    return c.json({ id }, 201)
  })
}

// ─── /api/fs/browse ───────────────────────────────────────────────────────────

const HIDDEN_PREFIXES = [".git", ".opencode", ".svelte-kit", "node_modules", ".pnpm"]

export function registerFsBrowseHttp(
  app: Hono,
  opts: {
    /** Security guard: paths outside this base return 403. Default: os.homedir(). */
    allowedBase?: string
  } = {},
): void {
  const allowedBase = opts.allowedBase ?? homedir()

  app.get("/api/fs/browse", async (c) => {
    const rawPath = c.req.query("path")
    if (!rawPath) {
      return c.json({ error: "path query param is required" }, 400)
    }

    // Resolve to absolute, then realpath to follow symlinks
    const normalized = resolve(rawPath)
    let real: string
    try {
      real = await realpath(normalized)
    } catch {
      return c.json({ error: "path not found" }, 404)
    }

    // Security: must be within allowedBase
    const safeBase = await realpath(allowedBase).catch(() => allowedBase)
    if (!real.startsWith(`${safeBase}/`) && real !== safeBase) {
      return c.json({ error: "access denied" }, 403)
    }

    let dirents: import("node:fs").Dirent<string>[]
    try {
      dirents = await readdir(real, { withFileTypes: true, encoding: "utf8" })
    } catch {
      return c.json({ error: "cannot read directory" }, 500)
    }

    const entries = dirents
      .filter((d) => !HIDDEN_PREFIXES.some((prefix) => d.name.startsWith(prefix)))
      .map((d) => ({
        name: d.name,
        isDir: d.isDirectory() || d.isSymbolicLink(), // treat symlinks as navigable
      }))
      .sort((a, b) => {
        // Dirs first, then files, then alphabetical
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    return c.json({ path: real, entries })
  })
}
