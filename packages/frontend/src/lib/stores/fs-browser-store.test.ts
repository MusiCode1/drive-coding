/**
 * fs-browser-store.test.ts — Phase 11 TDD
 *
 * Tests for the filesystem browser store (navigation, history).
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { createFsBrowserStore } from "./fs-browser-store.svelte"

function mockFetch(path: string, entries: Array<{ name: string; isDir: boolean }>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ path, entries }),
  })
}

describe("createFsBrowserStore (Phase 11)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── 1: browse() populates entries (dirs only) ─────────────────────────────
  it("browse() populates entries filtering to isDir=true only", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch("/home/user", [
        { name: "projects", isDir: true },
        { name: "file.txt", isDir: false },
        { name: "docs", isDir: true },
      ]),
    )
    const store = createFsBrowserStore("/home")
    await store.browse("/home/user")
    expect(store.entries).toHaveLength(2)
    expect(store.entries.every((e) => e.isDir)).toBe(true)
    expect(store.currentPath).toBe("/home/user")
  })

  // ── 2: enter() pushes current path to history and navigates ───────────────
  it("enter() pushes currentPath to history and navigates", async () => {
    vi.stubGlobal("fetch", mockFetch("/home/user/projects", []))
    const store = createFsBrowserStore("/home/user")
    await store.enter("projects")
    expect(store.currentPath).toBe("/home/user/projects")
    expect(store.canGoBack).toBe(true)
  })

  // ── 3: back() navigates to previous path ──────────────────────────────────
  it("back() returns to previous path", async () => {
    const store = createFsBrowserStore("/home/user")
    let callCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++
        const path = callCount === 1 ? "/home/user/projects" : "/home/user"
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ path, entries: [] }) })
      }),
    )
    await store.enter("projects")
    expect(store.currentPath).toBe("/home/user/projects")
    await store.back()
    expect(store.currentPath).toBe("/home/user")
    expect(store.canGoBack).toBe(false)
  })

  // ── 4: browse() sets error on failure ─────────────────────────────────────
  it("browse() sets error on API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "access denied" }),
      }),
    )
    const store = createFsBrowserStore("/home")
    await store.browse("/root")
    expect(store.error).toMatch(/access denied/)
  })
})
