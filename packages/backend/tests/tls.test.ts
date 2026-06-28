/**
 * tls.test.ts — TDD tests for resolveTls().
 *
 * Covers:
 *  1. No env → null (HTTP mode)
 *  2. "false" string → null
 *  3. Malformed JSON → null + warn (no crash)
 *  4. true → generates valid PEM key+cert (self-signed, idempotent)
 *  5. true second time → reads existing (same cert, idempotent)
 *  6. {key,cert} paths → reads files and returns their contents
 *  7. Missing path → null + warn (no crash)
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock child_process to avoid execFileSync side effects (getHomeDir uses it on Windows)
const execFileSyncMock = vi.fn().mockReturnValue("")
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}))

import { resolveTls } from "../src/tls.js"

let tmpHome: string

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tls-test-"))
  vi.stubEnv("HOME", tmpHome)
  vi.stubEnv("USERPROFILE", "")
  vi.stubEnv("DRIVE_CODING_HTTPS", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe("resolveTls", () => {
  it("returns null when DRIVE_CODING_HTTPS is not set", () => {
    const env: NodeJS.ProcessEnv = {}
    expect(resolveTls(env)).toBeNull()
  })

  it("returns null for string 'false'", () => {
    const env: NodeJS.ProcessEnv = { DRIVE_CODING_HTTPS: "false" }
    expect(resolveTls(env)).toBeNull()
  })

  it("returns null + warns for malformed JSON (no crash)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const env: NodeJS.ProcessEnv = { DRIVE_CODING_HTTPS: "not-valid-json" }
    expect(resolveTls(env)).toBeNull()
    warnSpy.mockRestore()
  })

  it("generates valid PEM key+cert for DRIVE_CODING_HTTPS=true", () => {
    const env: NodeJS.ProcessEnv = { DRIVE_CODING_HTTPS: "true" }
    const result = resolveTls(env)
    expect(result).not.toBeNull()
    expect(result!.key).toContain("-----BEGIN")
    expect(result!.cert).toContain("-----BEGIN")
  })

  it("is idempotent — second call returns same cert", () => {
    const env: NodeJS.ProcessEnv = { DRIVE_CODING_HTTPS: "true" }
    const first = resolveTls(env)
    const second = resolveTls(env)
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first!.cert).toBe(second!.cert)
  })

  it("reads key+cert from {key,cert} paths", () => {
    const keyPath = path.join(tmpHome, "test.key")
    const certPath = path.join(tmpHome, "test.cert")
    fs.writeFileSync(keyPath, "FAKE-KEY-CONTENT", "utf8")
    fs.writeFileSync(certPath, "FAKE-CERT-CONTENT", "utf8")

    const env: NodeJS.ProcessEnv = {
      DRIVE_CODING_HTTPS: JSON.stringify({ key: keyPath, cert: certPath }),
    }
    const result = resolveTls(env)
    expect(result).not.toBeNull()
    expect(result!.key).toBe("FAKE-KEY-CONTENT")
    expect(result!.cert).toBe("FAKE-CERT-CONTENT")
  })

  it("returns null + warns when path does not exist", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const env: NodeJS.ProcessEnv = {
      DRIVE_CODING_HTTPS: JSON.stringify({
        key: "/nonexistent/path/key.pem",
        cert: "/nonexistent/path/cert.pem",
      }),
    }
    expect(resolveTls(env)).toBeNull()
    warnSpy.mockRestore()
  })
})
