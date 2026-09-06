/**
 * Unit tests for WebDAV PROPFIND parsing / path mapping (no live server).
 */
import { describe, expect, it } from "vitest"
import {
  absToWebdavPath,
  isUnderRoot,
  parsePropfindEntries,
  readWebdavBrowseConfig,
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
    expect(absToWebdavPath("/home/user/projects/Dockhand", "/home/user")).toBe(
      "/projects/Dockhand",
    )
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
