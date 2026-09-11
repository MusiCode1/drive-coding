/**
 * WebDAV directory listing for GET /api/fs/browse?via=webdav (private remote FS).
 *
 * Env (all required when via=webdav is used):
 *   FS_BROWSE_WEBDAV_URL   — e.g. http://127.0.0.1:17654 (SSH tunnel to rclone serve)
 *   FS_BROWSE_WEBDAV_USER  — Basic auth user
 *   FS_BROWSE_WEBDAV_PASS  — Basic auth password
 *   FS_BROWSE_WEBDAV_ROOT  — absolute root on the remote host (e.g. /home/user)
 *
 * Maps absolute remote paths under ROOT to WebDAV hrefs relative to that root.
 * No local realpath — the path may not exist on the BE machine.
 */

export type WebdavBrowseEntry = { name: string; isDir: boolean }
export type WebdavBrowseResult = { path: string; entries: WebdavBrowseEntry[] }

const NOISE_DIRS = new Set<string>(["node_modules"])

export type WebdavBrowseConfig = {
  baseUrl: string
  user: string
  pass: string
  /** Absolute path on the remote machine that is the WebDAV document root. */
  root: string
}

export function readWebdavBrowseConfig(
  env: NodeJS.ProcessEnv = process.env,
): WebdavBrowseConfig | null {
  const baseUrl = env.FS_BROWSE_WEBDAV_URL?.trim()
  const user = env.FS_BROWSE_WEBDAV_USER?.trim()
  const pass = env.FS_BROWSE_WEBDAV_PASS
  const root = env.FS_BROWSE_WEBDAV_ROOT?.trim()
  if (!baseUrl || !user || pass === undefined || pass === "" || !root) return null
  return { baseUrl: baseUrl.replace(/\/+$/, ""), user, pass, root: normalizeAbs(root) }
}

function normalizeAbs(p: string): string {
  const collapsed = p.replace(/\/+/g, "/")
  if (collapsed.length > 1 && collapsed.endsWith("/")) return collapsed.slice(0, -1)
  return collapsed || "/"
}

/** True iff `path` is `root` or a descendant (POSIX absolute paths). */
export function isUnderRoot(path: string, root: string): boolean {
  const p = normalizeAbs(path)
  const r = normalizeAbs(root)
  return p === r || p.startsWith(`${r}/`)
}

/** Absolute remote path → WebDAV path (always starts with /). */
export function absToWebdavPath(absPath: string, root: string): string {
  const p = normalizeAbs(absPath)
  const r = normalizeAbs(root)
  if (p === r) return "/"
  const rel = p.slice(r.length) // begins with /
  return rel.startsWith("/") ? rel : `/${rel}`
}

function decodeHrefPath(href: string): string {
  try {
    // Absolute URL or path — take pathname
    if (href.startsWith("http://") || href.startsWith("https://")) {
      return decodeURIComponent(new URL(href).pathname)
    }
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

/**
 * Parse a Depth:1 PROPFIND multistatus body into child entries (excluding self).
 */
export function parsePropfindEntries(
  xml: string,
  webdavDirPath: string,
): WebdavBrowseEntry[] {
  const selfNorm = normalizeAbs(webdavDirPath === "" ? "/" : webdavDirPath)
  const entries: WebdavBrowseEntry[] = []
  const responseRe = /<D:response\b[^>]*>([\s\S]*?)<\/D:response>/gi
  let m: RegExpExecArray | null
  while ((m = responseRe.exec(xml)) !== null) {
    const block = m[1] ?? ""
    const hrefMatch = /<D:href>([^<]*)<\/D:href>/i.exec(block)
    if (!hrefMatch) continue
    let hrefPath = decodeHrefPath(hrefMatch[1] ?? "")
    // Trailing slash marks collections in rclone listings
    const trailingSlash = hrefPath.endsWith("/")
    hrefPath = normalizeAbs(hrefPath)
    if (hrefPath === selfNorm) continue

    const isCollection =
      trailingSlash || /<D:collection\b/i.test(block) || /<d:collection\b/i.test(block)

    const parent = selfNorm === "/" ? "/" : selfNorm
    let name: string
    if (parent === "/") {
      name = hrefPath.replace(/^\//, "").split("/")[0] ?? ""
    } else if (hrefPath.startsWith(`${parent}/`)) {
      name = hrefPath.slice(parent.length + 1).split("/")[0] ?? ""
    } else {
      // Unexpected sibling — skip
      continue
    }
    if (!name) continue
    entries.push({ name, isDir: isCollection })
  }
  // Dedupe by name (prefer isDir true)
  const byName = new Map<string, WebdavBrowseEntry>()
  for (const e of entries) {
    const prev = byName.get(e.name)
    if (!prev || (!prev.isDir && e.isDir)) byName.set(e.name, e)
  }
  return [...byName.values()]
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".") || NOISE_DIRS.has(name)
}

export async function browseWebdav(
  absPath: string,
  opts: { showHidden: boolean; config: WebdavBrowseConfig; fetchImpl?: typeof fetch },
): Promise<{ ok: true; result: WebdavBrowseResult } | { ok: false; status: 400 | 403 | 404 | 502; error: string }> {
  const root = opts.config.root
  const path = normalizeAbs(absPath)
  if (!path.startsWith("/")) {
    return { ok: false, status: 400, error: "path must be absolute" }
  }
  if (!isUnderRoot(path, root)) {
    return { ok: false, status: 403, error: "access denied" }
  }

  const davPath = absToWebdavPath(path, root)
  const urlPath = davPath === "/" ? "/" : davPath.endsWith("/") ? davPath : `${davPath}/`
  const url = `${opts.config.baseUrl}${urlPath}`

  const auth = Buffer.from(`${opts.config.user}:${opts.config.pass}`, "utf8").toString("base64")
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>`

  const fetchFn = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchFn(url, {
      method: "PROPFIND",
      headers: {
        Depth: "1",
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/xml; charset=utf-8",
      },
      body,
    })
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `webdav unreachable: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (res.status === 404) {
    return { ok: false, status: 404, error: "path not found" }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: 502, error: "webdav auth failed" }
  }
  // 207 Multi-Status is success; some servers return 200
  if (res.status !== 207 && res.status !== 200) {
    return { ok: false, status: 502, error: `webdav HTTP ${res.status}` }
  }

  const xml = await res.text()
  let entries = parsePropfindEntries(xml, davPath)
  if (!opts.showHidden) {
    entries = entries.filter((e) => !isHiddenName(e.name))
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return { ok: true, result: { path, entries } }
}
