/**
 * projects-store.test.ts — Phase 9 TDD
 *
 * Tests for the projects store (fetch, sort, cache).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createProjectsStore } from "./projects-store.svelte"

// Mock fetch
function makeMockFetch(sessions: unknown[], projects: unknown[]) {
  return vi.fn((url: string) => {
    const res =
      url.includes("/api/projects") && !url.includes("/sessions") ? { projects } : { sessions }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(res),
    })
  })
}

describe("createProjectsStore (Phase 9)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── 1: load() populates sessions sorted by updatedAt DESC ─────────────────
  it("load() populates sessions sorted newest-first", async () => {
    const mockFetch = makeMockFetch(
      [
        {
          sessionId: "s1",
          cwd: "/a",
          title: "old",
          updatedAt: "2024-01-01T00:00:00Z",
          cliKind: "opencode",
        },
        {
          sessionId: "s2",
          cwd: "/a",
          title: "new",
          updatedAt: "2024-12-01T00:00:00Z",
          cliKind: "opencode",
        },
      ],
      [],
    )
    vi.stubGlobal("fetch", mockFetch)
    const store = createProjectsStore()
    await store.load()
    expect(store.sessions[0]?.sessionId).toBe("s2") // newest first
    expect(store.sessions[1]?.sessionId).toBe("s1")
  })

  // ── 2: load() populates projects ──────────────────────────────────────────
  it("load() populates projects list", async () => {
    const mockFetch = makeMockFetch(
      [],
      [{ cwdHash: "h1", cwd: "/my/project", lastSeen: "2024-01-01T00:00:00Z", sessionCount: 3 }],
    )
    vi.stubGlobal("fetch", mockFetch)
    const store = createProjectsStore()
    await store.load()
    expect(store.projects).toHaveLength(1)
    expect(store.projects[0]?.cwdHash).toBe("h1")
  })

  // ── 3: load() sets loading=true during fetch ───────────────────────────────
  it("loading is false after load() completes", async () => {
    const mockFetch = makeMockFetch([], [])
    vi.stubGlobal("fetch", mockFetch)
    const store = createProjectsStore()
    const p = store.load()
    // After await, loading should be false
    await p
    expect(store.loading).toBe(false)
  })

  // ── 4: load() caches — second call within 5s doesn't re-fetch ─────────────
  it("load() uses cache — second call within 5s skips fetch", async () => {
    const mockFetch = makeMockFetch([], [])
    vi.stubGlobal("fetch", mockFetch)
    const store = createProjectsStore()
    await store.load()
    await store.load() // second call — should hit cache
    // fetch called twice: once for sessions, once for projects
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  // ── 5: loadProjectSessions() returns sorted sessions for project ───────────
  it("loadProjectSessions() returns sessions sorted newest-first", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          sessions: [
            {
              sessionId: "old",
              cwd: "/p",
              title: "",
              updatedAt: "2024-01-01T00:00:00Z",
              cliKind: "opencode",
            },
            {
              sessionId: "new",
              cwd: "/p",
              title: "",
              updatedAt: "2024-12-01T00:00:00Z",
              cliKind: "opencode",
            },
          ],
        }),
    })
    vi.stubGlobal("fetch", mockFetch)
    const store = createProjectsStore()
    const result = await store.loadProjectSessions("hash123")
    expect(result[0]?.sessionId).toBe("new")
  })
})
