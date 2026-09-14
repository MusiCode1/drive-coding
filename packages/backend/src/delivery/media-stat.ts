/**
 * media-stat.ts — stat helper for _drive/media enrichment (same rules as GET /api/fs/file).
 */

import { mimeFromExt } from "@drive-coding/core/fs/media-catalog"
import { realpathSync, statSync } from "node:fs"
import { relative, resolve } from "node:path"
import { isAbsolutePath, normalizeRealpath } from "./http-history.js"

export function createMediaStatFn(allowedBase?: string): (uri: string) => { bytes: number } | null {
  return (uri: string) => {
    if (/^https?:\/\//i.test(uri)) return null

    let rawPath: string
    if (uri.startsWith("file://")) {
      try {
        rawPath = decodeURIComponent(uri.slice("file://".length))
      } catch {
        return null
      }
    } else if (isAbsolutePath(uri)) {
      rawPath = uri
    } else {
      return null
    }

    if (!isAbsolutePath(rawPath)) return null
    if (mimeFromExt(rawPath) === null) return null

    try {
      const real = normalizeRealpath(realpathSync(resolve(rawPath)))
      if (allowedBase !== undefined) {
        let safeBase: string
        try {
          safeBase = normalizeRealpath(realpathSync(allowedBase))
        } catch {
          safeBase = allowedBase
        }
        if (real !== safeBase) {
          const rel = relative(safeBase, real)
          if (rel.startsWith("..") || isAbsolutePath(rel)) return null
        }
      }
      return { bytes: statSync(real).size }
    } catch {
      return null
    }
  }
}
