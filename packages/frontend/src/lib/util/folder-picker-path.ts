/** Path helpers + start resolution for FolderPickerDialog (keeps .svelte script lean). */

export function getPathSeparator(path: string): string {
  return path.includes("\\") ? "\\" : "/"
}

export function isPathRoot(path: string): boolean {
  return path === "/" || /^[a-zA-Z]:[\\/]?$/.test(path)
}

export function pathBreadcrumbs(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean)
}

const WEBDAV_CLI = "tzlev-remote-cloud"
const DEFAULT_WEBDAV_ROOT = "/home/user"

export function usesWebdavBrowse(cliKind: string): boolean {
  return cliKind === WEBDAV_CLI
}

/** Prefer startPath / lastCwd when under remote root; else remote root. */
export function resolveWebdavStart(
  startPath: string,
  lastCwd: string,
  webdavRoot: string = DEFAULT_WEBDAV_ROOT,
): string {
  const root = webdavRoot.replace(/\/+$/, "") || DEFAULT_WEBDAV_ROOT
  const start = startPath.trim() || lastCwd
  if (start && (start === root || start.startsWith(`${root}/`))) return start
  return root
}
