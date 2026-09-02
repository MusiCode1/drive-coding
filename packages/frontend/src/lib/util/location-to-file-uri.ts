import { hasViewableExt, resolveFileUri } from "./file-path-links"

/** Maps a tool location to a viewer URI, or null when not openable. */
export function locationToFileUri(loc: { path: string }, cwd: string | null): string | null {
  if (!hasViewableExt(loc.path)) return null
  return resolveFileUri(loc.path, cwd)
}
