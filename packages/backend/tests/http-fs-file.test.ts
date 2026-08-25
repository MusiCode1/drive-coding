/**
 * http-fs-file.test.ts — integration tests for GET /api/fs/file (slice fs-file-proxy).
 *
 * Approach: integration — Hono app.request(), assert status + headers.
 * Two factories, same pattern as tests/http-history.test.ts:
 *   makeApp()                  → registerFsFileHttp(app, {})            // allow-all
 *   makeAppRestricted(base)    → registerFsFileHttp(app, {allowedBase: base})
 * The negative (403) test must pass WITHOUT a process restart and WITHOUT mutating
 * process.env — the allowedBase parameter exists precisely for this (§0.5 delta 4).
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerFsFileHttp } from "../src/delivery/http-fs-file.js"

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "dc-fs-file-test-"))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

function makeApp(): Hono {
  const app = new Hono()
  registerFsFileHttp(app, {})
  return app
}

function makeAppRestricted(allowedBase: string): Hono {
  const app = new Hono()
  registerFsFileHttp(app, { allowedBase })
  return app
}

describe("GET /api/fs/file", () => {
  it("1. missing uri → 400", async () => {
    const app = makeApp()
    const res = await app.request("/api/fs/file")
    expect(res.status).toBe(400)
  })

  it("2. not file:// and not absolute → 400", async () => {
    const app = makeApp()
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent("relative/path.md")}`)
    expect(res.status).toBe(400)
  })

  it("3. https URL → 400 (SSRF guard, before any IO)", async () => {
    const app = makeApp()
    const res = await app.request(
      `/api/fs/file?uri=${encodeURIComponent("https://evil.example/x.png")}`,
    )
    expect(res.status).toBe(400)
  })

  it("4. malformed percent-encoding (file:///tmp/%zz.md) → 400, not 500", async () => {
    const app = makeApp()
    const res = await app.request("/api/fs/file?uri=file:///tmp/%zz.md")
    expect(res.status).toBe(400)
  })

  it("5. non-existent file → 404", async () => {
    const app = makeApp()
    const missing = join(workDir, "nope.md")
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(missing)}`)
    expect(res.status).toBe(404)
  })

  it("6a. .html → 415 (never served — the one real security boundary)", async () => {
    const app = makeApp()
    const p = join(workDir, "a.html")
    await writeFile(p, "<script>alert(1)</script>")
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.status).toBe(415)
  })

  it("6b. .htm → 415", async () => {
    const app = makeApp()
    const p = join(workDir, "a.htm")
    await writeFile(p, "<script>alert(1)</script>")
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.status).toBe(415)
  })

  it("6c. unsupported extension (.exe) → 415", async () => {
    const app = makeApp()
    const p = join(workDir, "a.exe")
    await writeFile(p, Buffer.from([1, 2, 3]))
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.status).toBe(415)
  })

  it("7. file > 8MB → 413", async () => {
    const app = makeApp()
    const p = join(workDir, "big.png")
    await writeFile(p, Buffer.alloc(8 * 1024 * 1024 + 1, 1))
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.status).toBe(413)
  })

  it("8. valid .md → 200 + Content-Type: text/markdown; charset=utf-8", async () => {
    const app = makeApp()
    const p = join(workDir, "doc.md")
    await writeFile(p, "# hi")
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8")
  })

  it("9. valid .png → 200 + Content-Type: image/png", async () => {
    const app = makeApp()
    const p = join(workDir, "img.png")
    await writeFile(p, Buffer.from([1, 2, 3]))
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
  })

  it("10. .svg → 200 + Content-Security-Policy contains script-src 'none'", async () => {
    const app = makeApp()
    const p = join(workDir, "icon.svg")
    await writeFile(p, "<svg></svg>")
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-security-policy")).toContain("script-src 'none'")
  })

  it("11. every 200 response carries X-Content-Type-Options: nosniff", async () => {
    const app = makeApp()
    const p = join(workDir, "doc.md")
    await writeFile(p, "hi")
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("12. symlink → realpath resolved, target content served", async () => {
    const target = join(workDir, "real.md")
    await writeFile(target, "target content")
    const link = join(workDir, "link.md")
    await symlink(target, link)
    const app = makeApp()
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(link)}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("target content")
  })

  it("13. makeAppRestricted(base) + file outside base → 403", async () => {
    const base = join(tmpdir(), `dc-fs-file-base-${crypto.randomUUID()}`)
    const sibling = join(tmpdir(), `dc-fs-file-sibling-${crypto.randomUUID()}`)
    await mkdir(base, { recursive: true })
    await mkdir(sibling, { recursive: true })
    const p = join(sibling, "outside.md")
    await writeFile(p, "outside")
    try {
      const app = makeAppRestricted(base)
      const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
      expect(res.status).toBe(403)
    } finally {
      await rm(base, { recursive: true, force: true })
      await rm(sibling, { recursive: true, force: true })
    }
  })

  it("14. makeAppRestricted(base) + file inside a subdir of base → 200", async () => {
    const base = join(tmpdir(), `dc-fs-file-base-${crypto.randomUUID()}`)
    const sub = join(base, "inner")
    await mkdir(sub, { recursive: true })
    const p = join(sub, "inside.md")
    await writeFile(p, "inside")
    try {
      const app = makeAppRestricted(base)
      const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
      expect(res.status).toBe(200)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it("15. makeApp() (no allowedBase) + same outside file → 200 (allow-all is the default)", async () => {
    const base = join(tmpdir(), `dc-fs-file-base-${crypto.randomUUID()}`)
    const sibling = join(tmpdir(), `dc-fs-file-sibling-${crypto.randomUUID()}`)
    await mkdir(base, { recursive: true })
    await mkdir(sibling, { recursive: true })
    const p = join(sibling, "outside.md")
    await writeFile(p, "outside")
    try {
      const app = makeApp()
      const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
      expect(res.status).toBe(200)
    } finally {
      await rm(base, { recursive: true, force: true })
      await rm(sibling, { recursive: true, force: true })
    }
  })

  it("16. unicode path (file:///tmp/<hebrew>.md) → 200", async () => {
    const app = makeApp()
    const p = join(workDir, "מסמך.md")
    await writeFile(p, "עברית")
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(`file://${p}`)}`)
    expect(res.status).toBe(200)
  })

  it("17. file:// with a relative tail does not bypass the absolute-path check (finding-8)", async () => {
    const app = makeApp()
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent("file://relative.md")}`)
    expect(res.status).toBe(400)
  })

  // ─── charset tier (live user finding 25/08: UTF-8 markdown rendered as
  // windows-1255 gibberish, because Content-Type carried no charset and
  // X-Content-Type-Options: nosniff forbids the browser from guessing).
  //
  // 🔴 The invariant under test is NOT "detect the encoding". It is
  // "never declare a charset we have not verified": a yes/no question over
  // bytes we already hold in memory.
  it("18. .md with real UTF-8 hebrew → charset=utf-8 declared (the live bug)", async () => {
    const app = makeApp()
    const p = join(workDir, "heb.md")
    await writeFile(p, "# בדיקת קבצים\n", "utf8")
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("charset=utf-8")
  })

  it("19. .txt with UTF-8 → text/plain; charset=utf-8", async () => {
    const app = makeApp()
    const p = join(workDir, "note.txt")
    await writeFile(p, "שלום", "utf8")
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8")
  })

  it("20. .md with UTF-8 BOM → still valid, charset=utf-8", async () => {
    const app = makeApp()
    const p = join(workDir, "bom.md")
    await writeFile(
      p,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# hi", "utf8")]),
    )
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("charset=utf-8")
  })

  it("21. 🔴 .md in windows-1255 → we do NOT lie: no utf-8 declaration, served as bytes", async () => {
    const app = makeApp()
    const p = join(workDir, "legacy.md")
    // "# בדיקה\n" encoded as windows-1255 (ב=0xE1 ד=0xE3 י=0xE9 ק=0xF7 ה=0xE4).
    // 0xE1 is a 3-byte UTF-8 lead followed by 0xE3, which is not a continuation
    // byte ⇒ the sequence is definitively not valid UTF-8.
    await writeFile(p, Buffer.from([0x23, 0x20, 0xe1, 0xe3, 0xe9, 0xf7, 0xe4, 0x0a]))
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).not.toContain("charset=utf-8")
    expect(res.headers.get("content-type")).not.toContain("text/")
    expect(res.headers.get("content-type")).toBe("application/octet-stream")
  })

  it("22. .md in UTF-16LE (BOM ff fe) → not utf-8, served as bytes", async () => {
    const app = makeApp()
    const p = join(workDir, "utf16.md")
    await writeFile(p, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("# hi", "utf16le")]))
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/octet-stream")
  })

  it("23. binary .png whose bytes are invalid UTF-8 → untouched by the tier", async () => {
    const app = makeApp()
    const p = join(workDir, "img.png")
    await writeFile(p, Buffer.from([0xff, 0xd8, 0xe1, 0xe3]))
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.headers.get("content-type")).toBe("image/png")
  })

  it("24. .svg keeps its bare type — XML parsers assume UTF-8, no charset added", async () => {
    const app = makeApp()
    const p = join(workDir, "icon.svg")
    await writeFile(p, "<svg></svg>", "utf8")
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.headers.get("content-type")).toBe("image/svg+xml")
  })
})
