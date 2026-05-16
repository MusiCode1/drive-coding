import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { CacheStore } from "@drive-coding/core"

/**
 * DiskCache — simple on-disk TTS cache.
 * Stores mp3 files as `{dir}/{sha256}.mp3`.
 * Slice 5: no eviction. Files accumulate until manually cleared.
 */
export class DiskCache implements CacheStore {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
  }

  async get(key: string): Promise<Uint8Array | null> {
    const file = path.join(this.dir, `${key}.mp3`)
    try {
      const buf = await fs.readFile(file)
      return new Uint8Array(buf)
    } catch {
      return null
    }
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    const file = path.join(this.dir, `${key}.mp3`)
    await fs.writeFile(file, value)
  }
}
