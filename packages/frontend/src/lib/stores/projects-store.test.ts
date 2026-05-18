/**
 * projects-store.test.ts — Phase 9 TDD (updated fe-fetch-sessions)
 *
 * Session listing removed from store — tests updated accordingly.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { createProjectsStore } from "./projects-store.svelte"

// listProjects() computes cwdHash via cwdToHash. Stub it out so tests don't
// need Web Crypto and can provide pre-computed values.
vi.mock("@drive-coding/core/cwd-hash", () => ({
  cwdToHash: (cwd: string) => Promise.resolve(`hash(${cwd})`),
}))

function makeMockFetch(projects: unknown[]) {
  return vi.fn((_url: string) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ projects }),
    }),
  )
}

describe("createProjectsStore", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── 1: load() populates projects ─────────────────────────────────────────
  it("load() populates projects list", async () => {
    const mockFetch = makeMockFetch([
      { cwd: "/my/project", kind: "opencode", lastSeen: "2024-01-01T00:00:00Z" },
    ])
    vi.stubGlobal("fetch", mockFetch)
    const store = createProjectsStore()
    await store.load()
    expect(store.projects).toHaveLength(1)
    expect(store.projects[0]?.cwd).toBe("/my/project")
    expect(store.projects[0]?.cwdHash).toBe("hash(/my/project)")
  })

  // ── 2: loading is false after load() completes ────────────────────────────
  it("loading is false after load() completes", async () => {
    const mockFetch = makeMockFetch([])
    vi.stubGlobal("fetch", mockFetch)
    const store = createProjectsStore()
    await store.load()
    expect(store.loading).toBe(false)
  })

  // ── 3: load() caches — second call within 5s doesn't re-fetch ─────────────
  it("load() uses cache — second call within 5s skips fetch", async () => {
    const mockFetch = makeMockFetch([])
    vi.stubGlobal("fetch", mockFetch)
    const store = createProjectsStore()
    await store.load()
    await store.load() // second call — should hit cache
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  // ── 4: force=true bypasses cache ─────────────────────────────────────────
  it("load(force=true) bypasses the cache", async () => {
    const mockFetch = makeMockFetch([])
    vi.stubGlobal("fetch", mockFetch)
    const store = createProjectsStore()
    await store.load()
    await store.load(true) // forced
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  // ── 5: error handling ─────────────────────────────────────────────────────
  it("sets error state when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    )
    const store = createProjectsStore()
    await store.load()
    expect(store.error).toBeTruthy()
    expect(store.projects).toHaveLength(0)
  })
})
