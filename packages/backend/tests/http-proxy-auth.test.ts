/**
 * Integration tests: auth header injection in http-proxy (voice-keys-direct Commit 1).
 *
 * Approach: mount registerProxyHttp on a Hono test instance, stub global fetch
 * with vi.stubGlobal, and assert the headers passed to fetch.
 *
 * Covers DoD #3, #4, #5 from the brief:
 *   #3 ELEVENLABS_API_KEY set  → fetch called with xi-api-key: <key>
 *   #4 GEMINI_API_KEY set      → fetch called with x-goog-api-key: <key>
 *   #5 No key in env           → fetch called WITHOUT overriding the placeholder
 *      (passthrough — OneCLI compat)
 */

import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerProxyHttp } from "../src/delivery/http-proxy.js"

// ── helper: build a minimal mock Response ─────────────────────────────────

function mockResponse(body = "ok", status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  })
}

// ── helper: mount a fresh Hono app for each test ──────────────────────────

function buildApp(cacheBaseDir: string): Hono {
  const app = new Hono()
  registerProxyHttp(app, { cacheBaseDir, env: process.env })
  return app
}

describe("http-proxy auth injection (voice-keys-direct)", () => {
  let tmpDir: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-auth-int-"))
    // Snapshot env so we can restore after each test
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    }
    for (const [k, v] of Object.entries(originalEnv)) {
      process.env[k] = v
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("DoD #3: ELEVENLABS_API_KEY set → xi-api-key injected into fetch headers", async () => {
    process.env["ELEVENLABS_API_KEY"] = "el-test-key-xyz"
    delete process.env["GEMINI_API_KEY"]

    let capturedHeaders: Headers | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers as HeadersInit)
        return mockResponse()
      }),
    )

    const app = buildApp(tmpDir)
    const req = new Request("http://localhost/proxy/elevenlabs/v1/voices", {
      method: "GET",
      headers: { "xi-api-key": "browser-placeholder" },
    })
    await app.request(req.url, { method: req.method, headers: req.headers })

    expect(capturedHeaders).toBeDefined()
    expect(capturedHeaders!.get("xi-api-key")).toBe("el-test-key-xyz")
  })

  it("DoD #4: GEMINI_API_KEY set → x-goog-api-key injected into fetch headers", async () => {
    process.env["GEMINI_API_KEY"] = "gm-test-key-abc"
    delete process.env["ELEVENLABS_API_KEY"]

    let capturedHeaders: Headers | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers as HeadersInit)
        return mockResponse()
      }),
    )

    const app = buildApp(tmpDir)
    await app.request("http://localhost/proxy/google/v1beta/models/gemini:generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": "browser-placeholder-google" },
      body: JSON.stringify({ contents: [] }),
    })

    expect(capturedHeaders).toBeDefined()
    expect(capturedHeaders!.get("x-goog-api-key")).toBe("gm-test-key-abc")
  })

  it("DoD #5: no key in env → placeholder header passed through unchanged (OneCLI compat)", async () => {
    delete process.env["ELEVENLABS_API_KEY"]
    delete process.env["GEMINI_API_KEY"]

    let capturedHeaders: Headers | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers as HeadersInit)
        return mockResponse()
      }),
    )

    const app = buildApp(tmpDir)
    await app.request("http://localhost/proxy/elevenlabs/v1/voices", {
      method: "GET",
      headers: { "xi-api-key": "browser-placeholder" },
    })

    expect(capturedHeaders).toBeDefined()
    // Must NOT have been overridden — placeholder passes as-is
    expect(capturedHeaders!.get("xi-api-key")).toBe("browser-placeholder")
  })

  it("DoD #5 (google): no GEMINI_API_KEY → placeholder passes through unchanged", async () => {
    delete process.env["GEMINI_API_KEY"]
    delete process.env["ELEVENLABS_API_KEY"]

    let capturedHeaders: Headers | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers as HeadersInit)
        return mockResponse()
      }),
    )

    const app = buildApp(tmpDir)
    await app.request("http://localhost/proxy/google/v1beta/models", {
      method: "GET",
      headers: { "x-goog-api-key": "goog-placeholder" },
    })

    expect(capturedHeaders).toBeDefined()
    expect(capturedHeaders!.get("x-goog-api-key")).toBe("goog-placeholder")
  })

  it("unknown provider → 404 (no fetch, no auth lookup)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const app = buildApp(tmpDir)
    const res = await app.request("http://localhost/proxy/unknown/some/path", { method: "GET" })

    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
