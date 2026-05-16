/**
 * createDiskCache<T> — generic namespaced disk cache factory.
 *
 * Stores each entry as a raw binary file at:
 *   {baseDir}/{namespace}/{key}
 *
 * The caller supplies encode/decode functions; the factory handles
 * directory creation (idempotent, concurrent-safe) and file I/O.
 *
 * This replaces the old DiskCache class — cache-disk.ts is now a thin
 * wrapper that delegates to createDiskCache<Uint8Array>.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { Cache } from "@drive-coding/core/cache/types"

export function createDiskCache<T>(opts: {
  namespace: string
  baseDir: string
  encode: (value: T) => Uint8Array
  decode: (bytes: Uint8Array) => T
}): Cache<T> {
  const { namespace, baseDir, encode, decode } = opts
  const dir = path.join(baseDir, namespace)

  // Ensure the namespace directory exists (lazy, on first write).
  // We store the promise so concurrent first-writes share it.
  let initPromise: Promise<void> | null = null
  function ensureDir(): Promise<void> {
    if (!initPromise) {
      initPromise = fs.mkdir(dir, { recursive: true }).then(() => undefined)
    }
    return initPromise
  }

  function filePath(key: string): string {
    return path.join(dir, key)
  }

  return {
    async get(key: string): Promise<T | null> {
      try {
        const buf = await fs.readFile(filePath(key))
        return decode(new Uint8Array(buf))
      } catch {
        return null
      }
    },

    async set(key: string, value: T): Promise<void> {
      await ensureDir()
      await fs.writeFile(filePath(key), encode(value))
    },

    async has(key: string): Promise<boolean> {
      try {
        await fs.access(filePath(key))
        return true
      } catch {
        return false
      }
    },
  }
}
