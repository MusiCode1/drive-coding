/**
 * fs-browse.ts — adapter ל-GET /api/fs/browse.
 *
 * מחזיר רשימת תיקיות/קבצים עבור path נתון.
 * ה-BE מאובטח (allowedBase + realpath) — ה-FE רק קורא, לא מעקף.
 *
 * ─── redesign-6 ───
 */
import { beUrl } from "$lib/util/be-url"

export type FsEntry = { name: string; isDir: boolean }
export type FsBrowseResult = { path: string; entries: FsEntry[] }

export type BrowseFolderOpts = {
  showHidden?: boolean
  /** Private: remote FS via BE WebDAV proxy (tzlev-remote-cloud). */
  via?: "webdav"
}

export async function browseFolder(
  path: string,
  showHiddenOrOpts: boolean | BrowseFolderOpts = false,
): Promise<FsBrowseResult> {
  const opts: BrowseFolderOpts =
    typeof showHiddenOrOpts === "boolean"
      ? { showHidden: showHiddenOrOpts }
      : showHiddenOrOpts
  const params = new URLSearchParams({ path })
  if (opts.showHidden) params.set("showHidden", "true")
  if (opts.via) params.set("via", opts.via)
  const res = await fetch(beUrl(`/api/fs/browse?${params}`))
  if (!res.ok) throw new Error(`browse failed: ${res.status}`)
  return res.json() as Promise<FsBrowseResult>
}
