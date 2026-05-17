/**
 * Phase 3 — TDD tests for HTTP endpoints:
 *   GET /api/projects                        — list known projects
 *   GET /api/projects/:cwdHash/sessions      — sessions for a project (cache + fetch)
 *   GET /api/sessions                        — union across all cwds
 *   GET /api/recordings/:id                  — serve audio bytes
 *   GET /api/fs/browse?path=                 — directory listing (with security guard)
 */

import { createHash } from "node:crypto"
import { rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionInfo } from "../src/acp/acp-transport.js"
import { createProjectsRegistry } from "../src/app/projects-registry.js"
import { createRecordingsStore } from "../src/app/recordings-store.js"
import { createSessionsCache } from "../src/app/sessions-cache.js"
import {
  registerFsBrowseHttp,
  registerProjectsHttp,
  registerRecordingsHttp,
} from "../src/delivery/http-history.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cwdToHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("base64url")
}

let tmpDir: string

async function makeTmpDir(): Promise<string> {
  return join(tmpdir(), `dc-http-test-${crypto.randomUUID()}`)
}

// ─── /api/projects and /api/projects/:cwdHash/sessions ───────────────────────

describe("GET /api/projects", () => {
  beforeEach(async () => {
    tmpDir = await makeTmpDir()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  function makeApp(fetchSessions?: (cwd: string) => Promise<readonly SessionInfo[]>) {
    const app = new Hono()
    const projectsRegistry = createProjectsRegistry(tmpDir)
    const sessionsCache = createSessionsCache({ ttlMs: 60_000 })
    const fetchSessionsFn = fetchSessions ?? (() => Promise.resolve([]))
    registerProjectsHttp(app, { projectsRegistry, sessionsCache, fetchSessions: fetchSessionsFn })
    return { app, projectsRegistry, sessionsCache }
  }

  it("returns empty array when no projects recorded", async () => {
    const { app } = makeApp()
    const res = await app.request("/api/projects")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ projects: [] })
  })

  it("returns recorded projects with cwd, kind, lastSeen", async () => {
    const { app, projectsRegistry } = makeApp()
    await projectsRegistry.recordCwd("/home/user/proj", "opencode")

    const res = await app.request("/api/projects")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.projects).toHaveLength(1)
    expect(body.projects[0].cwd).toBe("/home/user/proj")
    expect(body.projects[0].kind).toBe("opencode")
  })

  it("GET /api/projects/:cwdHash/sessions — cache hit returns cached sessions without fetching", async () => {
    const fetchSpy = vi.fn().mockResolvedValue([])
    const { app, projectsRegistry, sessionsCache } = makeApp(fetchSpy)
    await projectsRegistry.recordCwd("/proj/x", "opencode")

    const cachedSessions: SessionInfo[] = [
      { sessionId: "s1", cwd: "/proj/x", title: "Cached", updatedAt: "2026-01-01T00:00:00Z" },
    ]
    sessionsCache.set("/proj/x", cachedSessions)

    const hash = cwdToHash("/proj/x")
    const res = await app.request(`/api/projects/${hash}/sessions`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions[0].sessionId).toBe("s1")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("GET /api/projects/:cwdHash/sessions — cache miss calls fetchSessions and caches result", async () => {
    const sessions: SessionInfo[] = [
      { sessionId: "s2", cwd: "/proj/y", title: "Fresh", updatedAt: "2026-02-01T00:00:00Z" },
    ]
    const fetchSpy = vi.fn().mockResolvedValue(sessions)
    const { app, projectsRegistry, sessionsCache } = makeApp(fetchSpy)
    await projectsRegistry.recordCwd("/proj/y", "opencode")

    const hash = cwdToHash("/proj/y")
    const res = await app.request(`/api/projects/${hash}/sessions`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions[0].sessionId).toBe("s2")
    expect(fetchSpy).toHaveBeenCalledOnce()

    // Second call should hit cache
    await app.request(`/api/projects/${hash}/sessions`)
    expect(fetchSpy).toHaveBeenCalledOnce() // still once
    expect(sessionsCache.get("/proj/y")).not.toBeNull()
  })

  it("GET /api/projects/:cwdHash/sessions — unknown cwdHash → 404", async () => {
    const { app } = makeApp()
    const hash = cwdToHash("/proj/unknown")
    const res = await app.request(`/api/projects/${hash}/sessions`)
    expect(res.status).toBe(404)
  })

  it("GET /api/sessions — merges sessions from all cwds, sorted by updatedAt DESC", async () => {
    const allSessions: SessionInfo[] = [
      { sessionId: "s-old", cwd: "/proj/a", title: "Old", updatedAt: "2026-01-01T00:00:00Z" },
      { sessionId: "s-new", cwd: "/proj/b", title: "New", updatedAt: "2026-06-01T00:00:00Z" },
    ]
    const fetchSpy = vi
      .fn()
      .mockImplementation((cwd: string) =>
        Promise.resolve(allSessions.filter((s) => s.cwd === cwd)),
      )
    const { app, projectsRegistry } = makeApp(fetchSpy)
    await projectsRegistry.recordCwd("/proj/a", "opencode")
    await projectsRegistry.recordCwd("/proj/b", "claude")

    const res = await app.request("/api/sessions")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessions).toHaveLength(2)
    expect(body.sessions[0].sessionId).toBe("s-new") // newest first
    expect(body.sessions[1].sessionId).toBe("s-old")
  })
})

// ─── /api/recordings/:id ─────────────────────────────────────────────────────

describe("GET /api/recordings/:id", () => {
  beforeEach(async () => {
    tmpDir = await makeTmpDir()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  function makeApp() {
    const app = new Hono()
    const recordingsStore = createRecordingsStore(tmpDir)
    registerRecordingsHttp(app, { recordingsStore })
    return { app, recordingsStore }
  }

  it("returns audio bytes with correct Content-Type when found", async () => {
    const { app, recordingsStore } = makeApp()
    const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00])
    const { id } = await recordingsStore.save(bytes, "audio/mpeg")

    const res = await app.request(`/api/recordings/${id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("audio/mpeg")
    const buf = await res.arrayBuffer()
    expect(new Uint8Array(buf)).toEqual(bytes)
  })

  it("returns 404 when recording not found", async () => {
    const { app } = makeApp()
    const res = await app.request("/api/recordings/non-existent-uuid")
    expect(res.status).toBe(404)
  })
})

// ─── /api/fs/browse ───────────────────────────────────────────────────────────

describe("GET /api/fs/browse", () => {
  function makeApp(allowedBase?: string) {
    const app = new Hono()
    registerFsBrowseHttp(app, { allowedBase: allowedBase ?? homedir() })
    return { app }
  }

  it("returns directory entries for a valid path", async () => {
    // Use /tmp (or tmpdir()) which definitely exists and has entries
    const { app } = makeApp(tmpdir()) // allow /tmp as base in tests
    const res = await app.request(`/api/fs/browse?path=${encodeURIComponent(tmpdir())}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toBe(tmpdir())
    expect(Array.isArray(body.entries)).toBe(true)
  })

  it("each entry has name and isDir fields", async () => {
    const { app } = makeApp(tmpdir())
    const res = await app.request(`/api/fs/browse?path=${encodeURIComponent(tmpdir())}`)
    const body = await res.json()
    if (body.entries.length > 0) {
      const entry = body.entries[0]
      expect(typeof entry.name).toBe("string")
      expect(typeof entry.isDir).toBe("boolean")
    }
  })

  it("returns 403 when path resolves outside allowedBase (path traversal)", async () => {
    // allowedBase is /tmp, but path is /etc → outside
    const { app } = makeApp(tmpdir())
    const res = await app.request("/api/fs/browse?path=/etc")
    expect(res.status).toBe(403)
  })

  it("returns 400 when path query param is missing", async () => {
    const { app } = makeApp()
    const res = await app.request("/api/fs/browse")
    expect(res.status).toBe(400)
  })
})
