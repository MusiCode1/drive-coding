/**
 * TDD tests for storage layer (updated fe-fetch-sessions):
 *   - projects-registry.ts: disk-backed JSON store of cwds
 *   - recordings-store.ts: disk-backed recordings (webm/mp3/wav)
 *
 * sessions-cache.ts removed — session listing is now FE-driven via ACP WS.
 */

import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createProjectsRegistry } from "../src/app/projects-registry.js"
import { createRecordingsStore } from "../src/app/recordings-store.js"

// ─── Helper ──────────────────────────────────────────────────────────────────

let tmpDir: string

async function makeTmpDir(): Promise<string> {
  // Use randomUUID so parallel test runs don't collide
  const dir = join(tmpdir(), `drive-coding-test-${crypto.randomUUID()}`)
  return dir // createProjectsRegistry / createRecordingsStore create the dir themselves
}

// ─── projects-registry ───────────────────────────────────────────────────────

describe("createProjectsRegistry", () => {
  beforeEach(async () => {
    tmpDir = await makeTmpDir()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("returns empty array when no cwds recorded yet", async () => {
    const registry = createProjectsRegistry(tmpDir)
    const projects = await registry.getProjects()
    expect(projects).toHaveLength(0)
  })

  it("persists a cwd + kind across instances (simulates server restart)", async () => {
    const reg1 = createProjectsRegistry(tmpDir)
    await reg1.recordCwd("/home/user/proj1", "opencode")

    // New instance from same baseDir = simulated restart
    const reg2 = createProjectsRegistry(tmpDir)
    const projects = await reg2.getProjects()

    expect(projects).toHaveLength(1)
    expect(projects[0]?.cwd).toBe("/home/user/proj1")
    expect(projects[0]?.kind).toBe("opencode")
    expect(projects[0]?.lastSeen).toBeTruthy()
  })

  it("duplicate cwd updates lastSeen instead of adding a new entry", async () => {
    const reg = createProjectsRegistry(tmpDir)
    await reg.recordCwd("/proj", "opencode")

    const before = await reg.getProjects()
    const firstSeen = before[0]?.lastSeen ?? ""

    // Ensure at least 1ms passes
    await new Promise((r) => setTimeout(r, 2))
    await reg.recordCwd("/proj", "opencode")

    const after = await reg.getProjects()
    expect(after).toHaveLength(1)
    expect(after[0]?.lastSeen).not.toBe(firstSeen)
  })

  it("getProjects returns sorted by lastSeen DESC (newest first)", async () => {
    const reg = createProjectsRegistry(tmpDir)
    await reg.recordCwd("/proj/a", "opencode")
    await new Promise((r) => setTimeout(r, 5))
    await reg.recordCwd("/proj/b", "claude")

    const projects = await reg.getProjects()
    expect(projects[0]?.cwd).toBe("/proj/b") // newer
    expect(projects[1]?.cwd).toBe("/proj/a") // older
  })

  it("recordSession updates lastSessionId for a known cwd", async () => {
    const reg = createProjectsRegistry(tmpDir)
    await reg.recordCwd("/proj", "opencode")
    await reg.recordSession("/proj", "sess-abc-123")

    const projects = await reg.getProjects()
    expect(projects[0]?.lastSessionId).toBe("sess-abc-123")
  })

  // ─── removeCwd (slice recent-projects-controls) ──────────────────────────────

  it("removeCwd removes a project from getProjects", async () => {
    const reg = createProjectsRegistry(tmpDir)
    await reg.recordCwd("/proj/secret", "opencode")

    await reg.removeCwd("/proj/secret")

    const projects = await reg.getProjects()
    expect(projects).toHaveLength(0)
  })

  it("a removed project returns after a subsequent recordCwd", async () => {
    const reg = createProjectsRegistry(tmpDir)
    await reg.recordCwd("/proj/secret", "opencode")
    await reg.removeCwd("/proj/secret")

    // חיבור חוזר לאותו cwd — הרשומה נוצרת מחדש ומוחזרת
    await reg.recordCwd("/proj/secret", "opencode")

    const projects = await reg.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]?.cwd).toBe("/proj/secret")
  })

  it("removeCwd on unknown cwd is a no-op", async () => {
    const reg = createProjectsRegistry(tmpDir)
    await reg.recordCwd("/proj/known", "opencode")

    // לא אמור לזרוק ולא לשנות שום דבר
    await expect(reg.removeCwd("/proj/unknown")).resolves.toBeUndefined()

    const projects = await reg.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]?.cwd).toBe("/proj/known")
  })
})

// ─── recordings-store ─────────────────────────────────────────────────────────

describe("createRecordingsStore", () => {
  beforeEach(async () => {
    tmpDir = await makeTmpDir()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("save + get roundtrip returns identical bytes and mimeType", async () => {
    const store = createRecordingsStore(tmpDir)
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const { id } = await store.save(bytes, "audio/webm")

    const result = await store.get(id)
    expect(result).not.toBeNull()
    expect(result?.mimeType).toBe("audio/webm")
    expect(Array.from(result?.bytes)).toEqual([1, 2, 3, 4, 5])
  })

  it("get with unknown id returns null", async () => {
    const store = createRecordingsStore(tmpDir)
    const result = await store.get("non-existent-uuid")
    expect(result).toBeNull()
  })

  it("creates baseDir recursively if it doesn't exist (idempotent init)", async () => {
    const nested = join(tmpDir, "deep", "path", "recordings")
    const store = createRecordingsStore(nested)
    const { id } = await store.save(new Uint8Array([42]), "audio/webm")

    const result = await store.get(id)
    expect(result).not.toBeNull()
    expect(result?.bytes[0]).toBe(42)
  })

  it("maps mimeType to correct file extension (webm, mp3, wav)", async () => {
    const store = createRecordingsStore(tmpDir)

    const { id: webmId } = await store.save(new Uint8Array([1]), "audio/webm")
    const { id: mp3Id } = await store.save(new Uint8Array([2]), "audio/mpeg")
    const { id: wavId } = await store.save(new Uint8Array([3]), "audio/wav")

    // get() works → correct file extension was used (index.json resolves filename)
    expect((await store.get(webmId))?.mimeType).toBe("audio/webm")
    expect((await store.get(mp3Id))?.mimeType).toBe("audio/mpeg")
    expect((await store.get(wavId))?.mimeType).toBe("audio/wav")
  })

  it("stats returns correct count and total bytes after multiple saves", async () => {
    const store = createRecordingsStore(tmpDir)

    await store.save(new Uint8Array([1, 2, 3]), "audio/webm") // 3 bytes
    await store.save(new Uint8Array([4, 5]), "audio/webm") // 2 bytes

    const { count, bytes } = await store.stats()
    expect(count).toBe(2)
    expect(bytes).toBe(5)
  })

  it("delete removes the recording — subsequent get returns null", async () => {
    const store = createRecordingsStore(tmpDir)
    const { id } = await store.save(new Uint8Array([1, 2, 3]), "audio/webm")

    await store.delete(id)
    expect(await store.get(id)).toBeNull()
  })

  it("stats after delete reduces count and bytes", async () => {
    const store = createRecordingsStore(tmpDir)
    const { id } = await store.save(new Uint8Array([1, 2, 3]), "audio/webm")
    await store.save(new Uint8Array([4]), "audio/webm")

    await store.delete(id)
    const { count, bytes } = await store.stats()
    expect(count).toBe(1)
    expect(bytes).toBe(1)
  })
})
