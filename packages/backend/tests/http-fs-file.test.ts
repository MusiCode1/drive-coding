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

  it("8. valid .md → 200 + Content-Type: text/markdown", async () => {
    const app = makeApp()
    const p = join(workDir, "doc.md")
    await writeFile(p, "# hi")
    const res = await app.request(`/api/fs/file?uri=${encodeURIComponent(p)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/markdown")
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
})
