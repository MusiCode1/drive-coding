/**
 * TDD tests for HTTP endpoints (updated fe-fetch-sessions):
 *   GET /api/projects          — list known projects
 *   GET /api/recordings/:id    — serve audio bytes
 *   GET /api/fs/browse?path=   — directory listing (with security guard)
 *
 * Removed (sessions now FE-driven via ACP WS):
 *   GET /api/projects/:cwdHash/sessions
 *   GET /api/sessions
 */

import { mkdir, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createProjectsRegistry } from "../src/app/projects-registry.js"
import { createRecordingsStore } from "../src/app/recordings-store.js"
import {
  registerFsBrowseHttp,
  registerProjectsHttp,
  registerRecordingsHttp,
} from "../src/delivery/http-history.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string

async function makeTmpDir(): Promise<string> {
  return join(tmpdir(), `dc-http-test-${crypto.randomUUID()}`)
}

// ─── /api/projects ───────────────────────────────────────────────────────────

describe("GET /api/projects", () => {
  beforeEach(async () => {
    tmpDir = await makeTmpDir()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  function makeApp() {
    const app = new Hono()
    const projectsRegistry = createProjectsRegistry(tmpDir)
    registerProjectsHttp(app, { projectsRegistry })
    return { app, projectsRegistry }
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

  it("returns lastSessionId when recordSession was called", async () => {
    const { app, projectsRegistry } = makeApp()
    await projectsRegistry.recordCwd("/proj/z", "opencode")
    await projectsRegistry.recordSession("/proj/z", "sess-xyz")

    const res = await app.request("/api/projects")
    const body = await res.json()
    expect(body.projects[0].lastSessionId).toBe("sess-xyz")
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
    const { app } = makeApp(tmpdir())
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
    const { app } = makeApp(tmpdir())
    const res = await app.request("/api/fs/browse?path=/etc")
    expect(res.status).toBe(403)
  })

  it("returns 400 when path query param is missing", async () => {
    const { app } = makeApp()
    const res = await app.request("/api/fs/browse")
    expect(res.status).toBe(400)
  })

  it("hides hidden folders by default (no showHidden param)", async () => {
    const base = join(tmpdir(), `dc-hidden-test-${crypto.randomUUID()}`)
    await mkdir(base, { recursive: true })
    await mkdir(join(base, "visible"))
    await mkdir(join(base, "node_modules"))
    await mkdir(join(base, ".git"))
    try {
      const { app } = makeApp(base)
      const res = await app.request(`/api/fs/browse?path=${encodeURIComponent(base)}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      const names: string[] = body.entries.map((e: { name: string }) => e.name)
      expect(names).toContain("visible")
      expect(names).not.toContain("node_modules")
      expect(names).not.toContain(".git")
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it("shows hidden folders when showHidden=true", async () => {
    const base = join(tmpdir(), `dc-hidden-test-${crypto.randomUUID()}`)
    await mkdir(base, { recursive: true })
    await mkdir(join(base, "visible"))
    await mkdir(join(base, "node_modules"))
    await mkdir(join(base, ".git"))
    try {
      const { app } = makeApp(base)
      const res = await app.request(
        `/api/fs/browse?path=${encodeURIComponent(base)}&showHidden=true`,
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      const names: string[] = body.entries.map((e: { name: string }) => e.name)
      expect(names).toContain("visible")
      expect(names).toContain("node_modules")
      expect(names).toContain(".git")
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
