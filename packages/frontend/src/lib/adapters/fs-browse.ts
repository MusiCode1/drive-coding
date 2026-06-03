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

export async function browseFolder(path: string, showHidden = false): Promise<FsBrowseResult> {
  const params = new URLSearchParams({ path })
  if (showHidden) params.set("showHidden", "true")
  const res = await fetch(beUrl(`/api/fs/browse?${params}`))
  if (!res.ok) throw new Error(`browse failed: ${res.status}`)
  return res.json() as Promise<FsBrowseResult>
}
