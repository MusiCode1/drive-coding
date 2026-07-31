/**
 * http-cli-logo.test.ts — TDD tests for GET /api/cli-logo/:cliId (slice cli-logo-serving).
 *
 * id-keyed, NOT path-keyed (§3 of the brief) — the client sends a cliId, the path is
 * resolved server-side from the merged CliSpec (trusted config), never from the request.
 *
 * `loadCliSpecsOverride` is memoized module-level (`_cached` in cli-config-file.ts).
 * Each test that swaps CLI_SPECS_FILE must vi.resetModules() + dynamic-import the
 * registration function fresh, or it will see the first test's cached value forever.
 * Same pattern as http-cli-availability.test.ts.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let workDir: string

beforeEach(async () => {
  vi.resetModules()
  workDir = await mkdtemp(join(tmpdir(), "dc-cli-logo-test-"))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  delete process.env.CLI_SPECS_FILE
  await rm(workDir, { recursive: true, force: true })
})

async function makeApp(): Promise<Hono> {
  const { registerCliLogoHttp } = await import("../src/delivery/http-cli-logo.js")
  const app = new Hono()
  registerCliLogoHttp(app)
  return app
}

async function writeSpecsFile(specs: Record<string, unknown>): Promise<void> {
  const specsPath = join(workDir, "cli-specs.jsonc")
  await writeFile(specsPath, JSON.stringify(specs))
  process.env.CLI_SPECS_FILE = specsPath
}

describe("GET /api/cli-logo/:cliId", () => {
  it("unknown cliId → 404", async () => {
    await writeSpecsFile({})
    const app = await makeApp()
    const res = await app.request("/api/cli-logo/nope")
    expect(res.status).toBe(404)
  })

  it("CLI without logo → 404", async () => {
    await writeSpecsFile({
      pi: { bin: "npx", args: ["-y", "pi-acp"], supportsModelFlag: false, displayName: "Pi" },
    })
    const app = await makeApp()
    const res = await app.request("/api/cli-logo/pi")
    expect(res.status).toBe(404)
  })

  it("logo file missing on disk → 404", async () => {
    await writeSpecsFile({
      pi: {
        bin: "npx",
        args: ["-y", "pi-acp"],
        supportsModelFlag: false,
        logo: join(workDir, "does-not-exist.png"),
      },
    })
    const app = await makeApp()
    const res = await app.request("/api/cli-logo/pi")
    expect(res.status).toBe(404)
  })

  it("disallowed extension (.txt) → 415", async () => {
    const logoPath = join(workDir, "bad.txt")
    await writeFile(logoPath, "not an image")
    await writeSpecsFile({
      pi: { bin: "npx", args: ["-y", "pi-acp"], supportsModelFlag: false, logo: logoPath },
    })
    const app = await makeApp()
    const res = await app.request("/api/cli-logo/pi")
    expect(res.status).toBe(415)
  })

  it("file over 1MB → 413", async () => {
    const logoPath = join(workDir, "huge.png")
    await writeFile(logoPath, Buffer.alloc(1024 * 1024 + 1, 1))
    await writeSpecsFile({
      pi: { bin: "npx", args: ["-y", "pi-acp"], supportsModelFlag: false, logo: logoPath },
    })
    const app = await makeApp()
    const res = await app.request("/api/cli-logo/pi")
    expect(res.status).toBe(413)
  })

  it("valid absolute path → 200 + correct Content-Type + bytes", async () => {
    const logoPath = join(workDir, "pi-logo.png")
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
    await writeFile(logoPath, bytes)
    await writeSpecsFile({
      pi: { bin: "npx", args: ["-y", "pi-acp"], supportsModelFlag: false, logo: logoPath },
    })
    const app = await makeApp()
    const res = await app.request("/api/cli-logo/pi")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    const body = new Uint8Array(await res.arrayBuffer())
    expect(Buffer.from(body)).toEqual(bytes)
  })

  it("relative logo path resolves against dirname(resolveCliSpecsPath())", async () => {
    const subDir = join(workDir, "assets")
    await mkdir(subDir, { recursive: true })
    const bytes = Buffer.from([1, 2, 3])
    await writeFile(join(subDir, "pi.svg"), bytes)
    await writeSpecsFile({
      pi: { bin: "npx", args: ["-y", "pi-acp"], supportsModelFlag: false, logo: "assets/pi.svg" },
    })
    const app = await makeApp()
    const res = await app.request("/api/cli-logo/pi")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/svg+xml")
  })

  it("traversal in logo (../../etc/passwd) — from trusted config, not the request; doesn't reach a real image → 404", async () => {
    await writeSpecsFile({
      pi: {
        bin: "npx",
        args: ["-y", "pi-acp"],
        supportsModelFlag: false,
        logo: "../../../../../../etc/passwd",
      },
    })
    const app = await makeApp()
    const res = await app.request("/api/cli-logo/pi")
    // /etc/passwd exists but has no allowlisted extension → 415 before any read;
    // either way it must never leak bytes back to the client.
    expect([404, 415]).toContain(res.status)
    if (res.status !== 404 && res.status !== 415) {
      throw new Error("unexpected success reading a traversal path")
    }
  })

  it("Cache-Control is no-cache (not immutable) — file may be replaced by the user", async () => {
    const logoPath = join(workDir, "pi-logo.png")
    await writeFile(logoPath, Buffer.from([1, 2, 3]))
    await writeSpecsFile({
      pi: { bin: "npx", args: ["-y", "pi-acp"], supportsModelFlag: false, logo: logoPath },
    })
    const app = await makeApp()
    const res = await app.request("/api/cli-logo/pi")
    expect(res.headers.get("cache-control")).toBe("no-cache")
  })
})
