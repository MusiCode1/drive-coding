import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DiskCache } from "../src/voice/cache-disk"

describe("DiskCache", () => {
  let tmpRoot: string
  let cacheDir: string
  let cache: DiskCache

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "disk-cache-test-"))
    cacheDir = path.join(tmpRoot, "cache")
    cache = new DiskCache(cacheDir)
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it("init() creates directory if not exists", async () => {
    await cache.init()
    const stat = await fs.stat(cacheDir)
    expect(stat.isDirectory()).toBe(true)
  })

  it("init() is idempotent — does not throw when directory already exists", async () => {
    await fs.mkdir(cacheDir, { recursive: true })
    await expect(cache.init()).resolves.toBeUndefined()
  })

  it("set() writes a file at {dir}/{key}.mp3", async () => {
    await cache.init()
    const data = new Uint8Array([0xff, 0xfb, 0x90, 0x44])
    await cache.set("abc123", data)

    const file = path.join(cacheDir, "abc123.mp3")
    const onDisk = await fs.readFile(file)
    expect(Array.from(onDisk)).toEqual(Array.from(data))
  })

  it("get() for existing key → returns same bytes (roundtrip)", async () => {
    await cache.init()
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    await cache.set("hello", data)

    const got = await cache.get("hello")
    expect(got).not.toBeNull()
    expect(Array.from(got ?? new Uint8Array())).toEqual(Array.from(data))
  })

  it("get() for missing key → returns null (no throw)", async () => {
    await cache.init()
    const got = await cache.get("does-not-exist")
    expect(got).toBeNull()
  })

  it("set() on same key twice → last write wins", async () => {
    await cache.init()
    const a = new Uint8Array([1, 1, 1])
    const b = new Uint8Array([2, 2, 2, 2])
    await cache.set("k", a)
    await cache.set("k", b)

    const got = await cache.get("k")
    expect(Array.from(got ?? new Uint8Array())).toEqual([2, 2, 2, 2])
  })

  it("key with special chars (sha256 hex-safe) works", async () => {
    await cache.init()
    const key = "a1b2c3d4e5f6789012345678901234567890abcdef01234567890abcdef012345"
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    await cache.set(key, data)

    const got = await cache.get(key)
    expect(Array.from(got ?? new Uint8Array())).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it("empty Uint8Array roundtrips correctly", async () => {
    await cache.init()
    const empty = new Uint8Array(0)
    await cache.set("empty", empty)

    const got = await cache.get("empty")
    expect(got).not.toBeNull()
    expect(got?.byteLength).toBe(0)
  })

  it("large blob (~100KB) roundtrips byte-exact", async () => {
    await cache.init()
    const size = 100 * 1024
    const data = new Uint8Array(size)
    for (let i = 0; i < size; i++) data[i] = i % 256
    await cache.set("big", data)

    const got = await cache.get("big")
    expect(got?.byteLength).toBe(size)
    // sample a few bytes
    expect(got?.[0]).toBe(0)
    expect(got?.[255]).toBe(255)
    expect(got?.[256]).toBe(0)
    expect(got?.[size - 1]).toBe((size - 1) % 256)
  })

  it("works without explicit init() if parent already exists — but missing dir → get returns null", async () => {
    // No init() — directory does not exist. get should return null gracefully.
    const got = await cache.get("any")
    expect(got).toBeNull()
  })
})
