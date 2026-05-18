/**
 * HTTP endpoints — session history support (updated fe-fetch-sessions).
 *
 *   GET  /api/projects   — list known projects (from registry)
 *   GET  /api/recordings/:id  — serve raw audio bytes
 *   POST /api/recordings      — upload and persist audio
 *   GET  /api/fs/browse?path= — directory listing (security-guarded)
 *
 * Removed (fe-fetch-sessions):
 *   GET /api/projects/:cwdHash/sessions — sessions now fetched FE-side via ACP WS
 *   GET /api/sessions                  — union view removed; see sessions-ws.ts on FE
 *
 * cwdHash = SHA-256(cwd) encoded as base64url (URL-safe, no padding).
 */

import { readdir, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { resolve } from "node:path"
import type { Hono } from "hono"
import type { ProjectsRegistry } from "../app/projects-registry.js"
import type { RecordingsStore } from "../app/recordings-store.js"

// ─── /api/projects ────────────────────────────────────────────────────────────

export function registerProjectsHttp(
  app: Hono,
  deps: {
    projectsRegistry: ProjectsRegistry
  },
): void {
  // GET /api/projects
  app.get("/api/projects", async (c) => {
    const projects = await deps.projectsRegistry.getProjects()
    return c.json({ projects })
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
