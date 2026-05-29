/**
 * createDiskCache<T> — factory גנרי למטמון דיסק מבוסס namespace.
 *
 * שומר כל רשומה כקובץ בינארי גולמי ב:
 *   {baseDir}/{namespace}/{key}
 *
 * הקורא מספק פונקציות קידוד/פענוח (encode/decode); ה-factory מטפל
 * ביצירת הספריה (אידמפוטנטי, בטוח למקביליות) וקלט/פלט של קבצים.
 *
 * זה מחליף את המחלקה הישנה DiskCache — כעת cache-disk.ts הוא עטיפה
 * דקה שמאצילה ל-createDiskCache<Uint8Array>.
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

  // ודא שספריית ה-namespace קיימת (lazy, בכתיבה ראשונה).
  // אנו שומרים את ההבטחה (promise) כך שכתיבות ראשונות מקבילות ישתפו אותה.
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
