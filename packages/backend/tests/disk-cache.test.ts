/**
 * Phase 1 — createDiskCache<T> factory tests.
 *
 * Covers: encode/decode roundtrip, namespace separation, set/get,
 * missing key, idempotent init, concurrent writes, has().
 */

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createDiskCache } from "../src/voice/cache.js"

// ─── helpers ─────────────────────────────────────────────────

function makeTmpDir(): string {
  return path.join(
    os.tmpdir(),
    `disk-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
}

const bytesCodec = {
  encode: (v: Uint8Array) => v,
  decode: (v: Uint8Array) => v,
}

const stringCodec = {
  encode: (v: string) => new TextEncoder().encode(v),
  decode: (v: Uint8Array) => new TextDecoder().decode(v),
}

// ─── tests ───────────────────────────────────────────────────

describe("createDiskCache — Uint8Array roundtrip", () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = makeTmpDir()
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("CACHE-1: stores and retrieves Uint8Array identically", async () => {
    const cache = createDiskCache({ namespace: "tts", baseDir: tmpDir, ...bytesCodec })
    const value = new Uint8Array([1, 2, 3, 255, 0, 128])
    await cache.set("key1", value)
    const result = await cache.get("key1")
    expect(result).not.toBeNull()
    expect(Array.from(result ?? new Uint8Array())).toEqual(Array.from(value))
  })
})

describe("createDiskCache — string roundtrip", () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = makeTmpDir()
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("CACHE-2: stores and retrieves string identically", async () => {
    const cache = createDiskCache({ namespace: "translation", baseDir: tmpDir, ...stringCodec })
    const text = "שלום עולם — hello world"
    await cache.set("key2", text)
    const result = await cache.get("key2")
    expect(result).toBe(text)
  })
})

describe("createDiskCache — namespace separation", () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = makeTmpDir()
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("CACHE-3: two caches with different namespaces don't share entries", async () => {
    const cacheA = createDiskCache({ namespace: "ns-a", baseDir: tmpDir, ...stringCodec })
    const cacheB = createDiskCache({ namespace: "ns-b", baseDir: tmpDir, ...stringCodec })
    await cacheA.set("shared-key", "value-from-A")
    const fromB = await cacheB.get("shared-key")
    expect(fromB).toBeNull()
  })

  it("CACHE-4: same namespace, same key → same entry", async () => {
    const cache1 = createDiskCache({ namespace: "ns-c", baseDir: tmpDir, ...stringCodec })
    const cache2 = createDiskCache({ namespace: "ns-c", baseDir: tmpDir, ...stringCodec })
    await cache1.set("k", "hello")
    const result = await cache2.get("k")
    expect(result).toBe("hello")
  })
})

describe("createDiskCache — missing key", () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = makeTmpDir()
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("CACHE-5: get() returns null for unknown key", async () => {
    const cache = createDiskCache({ namespace: "tts", baseDir: tmpDir, ...bytesCodec })
    const result = await cache.get("does-not-exist")
    expect(result).toBeNull()
  })
})

describe("createDiskCache — idempotent directory creation", () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = makeTmpDir()
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("CACHE-6: multiple caches with same namespace don't throw on concurrent init", async () => {
    // Creating several caches pointing to the same namespace concurrently
    const caches = Array.from({ length: 5 }, () =>
      createDiskCache({ namespace: "same", baseDir: tmpDir, ...stringCodec }),
    )
    // All writing concurrently — should not throw EEXIST
    await expect(
      Promise.all(caches.map((c, i) => c.set(`key-${i}`, `val-${i}`))),
    ).resolves.not.toThrow()
  })
})

describe("createDiskCache — concurrent writes", () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = makeTmpDir()
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("CACHE-7: concurrent writes to different keys don't corrupt each other", async () => {
    const cache = createDiskCache({ namespace: "tts", baseDir: tmpDir, ...stringCodec })
    const pairs = Array.from({ length: 10 }, (_, i) => [`key-${i}`, `value-${i}`] as const)
    await Promise.all(pairs.map(([k, v]) => cache.set(k, v)))
    const results = await Promise.all(pairs.map(([k]) => cache.get(k)))
    for (const [i, result] of results.entries()) {
      expect(result).toBe(`value-${i}`)
    }
  })
})

describe("createDiskCache — has()", () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = makeTmpDir()
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("CACHE-8: has() returns false before set, true after set", async () => {
    const cache = createDiskCache({ namespace: "has-test", baseDir: tmpDir, ...stringCodec })
    expect(await cache.has("k")).toBe(false)
    await cache.set("k", "hello")
    expect(await cache.has("k")).toBe(true)
  })
})
