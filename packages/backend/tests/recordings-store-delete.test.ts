import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRecordingsStore } from "../src/app/recordings-store.js"

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...fs,
    readFile: vi.fn(fs.readFile),
    rename: vi.fn(fs.rename),
    unlink: vi.fn(fs.unlink),
  }
})

const bytes = new Uint8Array([1, 2, 3])
const mimeType = "audio/webm"

describe("recording index mutations", () => {
  let baseDir: string
  let indexPath: string
  let store: ReturnType<typeof createRecordingsStore>

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "dc-recordings-store-delete-"))
    indexPath = join(baseDir, "index.json")
    store = createRecordingsStore(baseDir)
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetAllMocks()
    await rm(baseDir, { recursive: true, force: true })
  })

  it("treats only a missing index as empty", async () => {
    await expect(store.delete(randomUUID())).resolves.toBeUndefined()
    expect(await readdir(baseDir)).toEqual([])

    await mkdir(indexPath)
    await expect(store.delete(randomUUID())).rejects.toMatchObject({ code: "EISDIR" })
  })

  it.each(["null", "[]", "{}", '{"recordings":[]}'])(
    "rejects unexpected index shape %s without writing over it",
    async (text) => {
      await writeFile(indexPath, text)
      await expect(store.delete(randomUUID())).rejects.toThrow()
      await expect(store.save(bytes, mimeType)).rejects.toThrow()
      expect(await readFile(indexPath, "utf8")).toBe(text)
      expect(await readdir(baseDir)).toEqual(["index.json"])
    },
  )

  it.each([
    ["another recording's UUID", (id: string) => `${id}.webm`],
    ["a subdirectory", (id: string) => `nested/${id}.webm`],
    ["a Windows separator", (id: string) => `nested\\${id}.webm`],
    ["a parent directory", (id: string) => `../${id}.webm`],
    ["an unsupported extension", (id: string) => `${id}.wav.bak`],
  ] as const)("does not unlink a filename referencing %s", async (label, unsafeFilename) => {
    const target = await store.save(bytes, mimeType)
    const kept = await store.save(bytes, mimeType)
    const recordingId = label === "another recording's UUID" ? kept.id : target.id
    const previousIndex = JSON.parse(await readFile(indexPath, "utf8"))
    previousIndex.recordings[target.id].filename = unsafeFilename(recordingId)
    const corrupted = JSON.stringify(previousIndex)
    await writeFile(indexPath, corrupted)

    await expect(store.delete(target.id)).rejects.toThrow()
    expect(unlink).not.toHaveBeenCalled()
    expect(await readFile(indexPath, "utf8")).toBe(corrupted)
    expect(await store.get(kept.id)).toEqual({ bytes, mimeType })
  })

  it("does not coerce inherited object keys into recording metadata", async () => {
    await store.save(bytes, mimeType)
    const previousIndex = await readFile(indexPath, "utf8")
    await expect(store.delete("__proto__")).rejects.toThrow()
    await expect(store.delete("constructor")).rejects.toThrow()
    expect(unlink).not.toHaveBeenCalled()
    expect(await readFile(indexPath, "utf8")).toBe(previousIndex)
  })

  it("handles the fallback extension used by saved recordings", async () => {
    const { id } = await store.save(bytes, "application/octet-stream")
    await readFile(join(baseDir, `${id}.bin`))
    await store.delete(id)
    expect(await readdir(baseDir)).toEqual(["index.json"])
  })

  it("cleans up a failed index publication and lets a queued upload and retry finish", async () => {
    const { id } = await store.save(bytes, mimeType)
    const previousIndex = await readFile(indexPath, "utf8")
    const publishing = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const failure = new Error("synthetic index publication failure")
    vi.mocked(rename).mockImplementationOnce(async (temp, destination) => {
      publishing.resolve()
      await release.promise
      expect(destination).toBe(indexPath)
      expect(dirname(String(temp))).toBe(baseDir)
      expect(temp).not.toBe(indexPath)
      expect(JSON.parse(await readFile(temp, "utf8"))).toEqual({ recordings: {} })
      expect(await readFile(indexPath, "utf8")).toBe(previousIndex)
      await expect(readFile(join(baseDir, `${id}.webm`))).rejects.toMatchObject({
        code: "ENOENT",
      })
      throw failure
    })

    const deletion = store.delete(id)
    const rejected = expect(deletion).rejects.toBe(failure)
    await Promise.race([publishing.promise, deletion])
    vi.mocked(readFile).mockClear()
    const upload = store.save(bytes, mimeType)
    await Promise.resolve()
    const readCallsBeforeRelease = vi.mocked(readFile).mock.calls.length
    release.resolve()
    const [saved] = await Promise.all([upload, rejected])
    expect(readCallsBeforeRelease).toBe(0)
    expect((await readdir(baseDir)).sort()).toEqual([`${saved.id}.webm`, "index.json"])
    expect(await readFile(indexPath, "utf8")).toContain(id)

    await store.delete(id)
    expect(await store.get(id)).toBeNull()
    expect(await store.get(saved.id)).toEqual({ bytes, mimeType })
    expect(await store.stats()).toEqual({ count: 1, bytes: bytes.length })
  })
})
