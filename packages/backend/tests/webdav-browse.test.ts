/**
 * Unit tests for WebDAV PROPFIND parsing / path mapping (no live server).
 */
import { describe, expect, it } from "vitest"
import {
  absToWebdavPath,
  fetchWebdavFile,
  isUnderRoot,
  parsePropfindEntries,
  readWebdavBrowseConfig,
  type WebdavBrowseConfig,
} from "../src/delivery/webdav-browse.ts"

describe("webdav-browse path helpers", () => {
  it("isUnderRoot", () => {
    expect(isUnderRoot("/home/user", "/home/user")).toBe(true)
    expect(isUnderRoot("/home/user/projects", "/home/user")).toBe(true)
    expect(isUnderRoot("/home/user2", "/home/user")).toBe(false)
    expect(isUnderRoot("/tmp", "/home/user")).toBe(false)
  })

  it("absToWebdavPath", () => {
    expect(absToWebdavPath("/home/user", "/home/user")).toBe("/")
    expect(absToWebdavPath("/home/user/projects", "/home/user")).toBe("/projects")
    expect(absToWebdavPath("/home/user/projects/Dockhand", "/home/user")).toBe("/projects/Dockhand")
  })

  it("readWebdavBrowseConfig requires all env", () => {
    expect(readWebdavBrowseConfig({})).toBeNull()
    expect(
      readWebdavBrowseConfig({
        FS_BROWSE_WEBDAV_URL: "http://127.0.0.1:17654",
        FS_BROWSE_WEBDAV_USER: "tzlev",
        FS_BROWSE_WEBDAV_PASS: "x",
        FS_BROWSE_WEBDAV_ROOT: "/home/user",
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:17654",
      user: "tzlev",
      pass: "x",
      root: "/home/user",
    })
  })
})

describe("parsePropfindEntries", () => {
  const sample = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response><D:href>/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
  <D:response><D:href>/projects/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
  <D:response><D:href>/.bashrc</D:href><D:propstat><D:prop><D:resourcetype/></D:prop></D:propstat></D:response>
  <D:response><D:href>/src/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
</D:multistatus>`

  it("skips self and extracts children", () => {
    const entries = parsePropfindEntries(sample, "/")
    const names = entries.map((e) => e.name).sort()
    expect(names).toEqual([".bashrc", "projects", "src"])
    expect(entries.find((e) => e.name === "projects")?.isDir).toBe(true)
    expect(entries.find((e) => e.name === ".bashrc")?.isDir).toBe(false)
  })
})

describe("fetchWebdavFile (fs serve — slice cli-transport)", () => {
  const cfg: WebdavBrowseConfig = {
    baseUrl: "http://127.0.0.1:17654",
    user: "dc",
    pass: "x",
    root: "/home/user",
  }

  it("GETs under root with Range + Basic auth and returns bytes", async () => {
    let seenUrl = ""
    let seenRange: string | null = null
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = url
      seenRange = new Headers(init.headers).get("Range")
      return new Response(new Uint8Array([1, 2, 3]), { status: 206 })
    }) as unknown as typeof fetch
    const res = await fetchWebdavFile("/home/user/notes/a.md", {
      config: cfg,
      maxBytes: 100,
      fetchImpl,
    })
    expect(res.ok).toBe(true)
    expect(res.ok === true && Array.from(res.bytes)).toEqual([1, 2, 3])
    expect(seenUrl).toBe("http://127.0.0.1:17654/notes/a.md")
    expect(seenRange).toBe("bytes=0-99")
  })

  it("403 for a path outside root (before any fetch)", async () => {
    let called = false
    const fetchImpl = (async () => {
      called = true
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch
    const res = await fetchWebdavFile("/etc/passwd", { config: cfg, maxBytes: 100, fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.status).toBe(403)
    expect(called).toBe(false)
  })

  it("maps 404 → 404", async () => {
    const fetchImpl = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch
    const res = await fetchWebdavFile("/home/user/missing", {
      config: cfg,
      maxBytes: 100,
      fetchImpl,
    })
    expect(res.ok === false && res.status).toBe(404)
  })

  it("413 when the server ignores Range and hands back too much", async () => {
    const big = new Uint8Array(50)
    const fetchImpl = (async () => new Response(big, { status: 200 })) as unknown as typeof fetch
    const res = await fetchWebdavFile("/home/user/big.md", { config: cfg, maxBytes: 10, fetchImpl })
    expect(res.ok === false && res.status).toBe(413)
  })
})
