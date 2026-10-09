/**
 * TDD tests for storage layer (updated fe-fetch-sessions):
 *   - session-history-store: SQLite projects + hide semantics
 *   - recordings-store.ts: disk-backed recordings (webm/mp3/wav)
 *
 * sessions-cache.ts removed — session listing is now FE-driven via ACP WS.
 */

import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createRecordingsStore } from "../src/app/recordings-store.js"
import { createSessionHistoryStore } from "../src/history/session-history-store.js"

// ─── Helper ──────────────────────────────────────────────────────────────────

let tmpDir: string

async function makeTmpDir(): Promise<string> {
  // Use randomUUID so parallel test runs don't collide
  const dir = join(tmpdir(), `drive-coding-test-${crypto.randomUUID()}`)
  return dir
}

function openStore() {
  const dbFile = join(tmpDir, "history.sqlite")
  return createSessionHistoryStore(dbFile)
}

function attach(
  store: ReturnType<typeof createSessionHistoryStore>,
  cwd: string,
  cliKind: string,
  acpSessionId: string,
  now: number,
) {
  store.recordAttach({
    agentId: "agent-1",
    acpSessionId,
    cliKind,
    cwd,
    now,
  })
}

// ─── session-history projects ───────────────────────────────────────────────

describe("sessionHistoryStore listProjects / hideFolder", () => {
  beforeEach(async () => {
    tmpDir = await makeTmpDir()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("returns empty array when no sessions recorded yet", () => {
    const store = openStore()
    expect(store.listProjects()).toHaveLength(0)
    store.close()
  })

  it("persists cwd + kind across store instances (simulates restart)", () => {
    const dbFile = join(tmpDir, "history.sqlite")
    const s1 = createSessionHistoryStore(dbFile)
    attach(s1, "/home/user/proj1", "opencode", "sess-1", 1000)
    s1.close()

    const s2 = createSessionHistoryStore(dbFile)
    const projects = s2.listProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]?.cwd).toBe("/home/user/proj1")
    expect(projects[0]?.kind).toBe("opencode")
    expect(projects[0]?.lastSeen).toBeTruthy()
    s2.close()
  })

  it("re-attach updates lastSeen for same cwd", () => {
    const store = openStore()
    attach(store, "/proj", "opencode", "sess-a", 1000)
    const first = store.listProjects()[0]?.lastSeen ?? ""
    attach(store, "/proj", "opencode", "sess-b", 2000)
    const after = store.listProjects()
    expect(after).toHaveLength(1)
    expect(after[0]?.lastSeen).not.toBe(first)
    expect(after[0]?.lastSessionId).toBe("sess-b")
    store.close()
  })

  it("listProjects sorted by lastSeen DESC", () => {
    const store = openStore()
    attach(store, "/proj/a", "opencode", "s1", 1000)
    attach(store, "/proj/b", "claude", "s2", 5000)
    const projects = store.listProjects()
    expect(projects[0]?.cwd).toBe("/proj/b")
    expect(projects[1]?.cwd).toBe("/proj/a")
    store.close()
  })

  it("hideFolder removes from listProjects", () => {
    const store = openStore()
    attach(store, "/proj/secret", "opencode", "s1", 1000)
    store.hideFolder("/proj/secret")
    expect(store.listProjects()).toHaveLength(0)
    store.close()
  })

  it("hidden folder reappears after recordAttach to same cwd", () => {
    const store = openStore()
    attach(store, "/proj/secret", "opencode", "s1", 1000)
    store.hideFolder("/proj/secret")
    attach(store, "/proj/secret", "opencode", "s2", 2000)
    const projects = store.listProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]?.cwd).toBe("/proj/secret")
    store.close()
  })

  it("hideFolder on unknown cwd is a no-op", () => {
    const store = openStore()
    attach(store, "/proj/known", "opencode", "s1", 1000)
    store.hideFolder("/proj/unknown")
    expect(store.listProjects()).toHaveLength(1)
    store.close()
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
