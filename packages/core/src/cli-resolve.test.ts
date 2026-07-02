/**
 * cli-resolve.test.ts — TDD tests for resolveCliBinary.
 *
 * Tests: env-override, PATH-hit, PATHEXT on Windows, pm-global-bins, knownPaths, miss→undefined.
 *
 * ESM note: vi.spyOn on named exports from node:fs is not configurable in ESM.
 * We use vi.mock('node:fs') with a factory instead.
 */

import * as path from "node:path"
import { describe, expect, it, vi, afterEach } from "vitest"

// Mock node:fs before importing the module under test.
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}))

// Import after mock is set up.
import { resolveCliBinary } from "./cli-resolve.js"
import * as fs from "node:fs"

// ─── env-override ──────────────────────────────────────────────────────────────

describe("resolveCliBinary: env-override", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })

  it("returns env var value immediately when set", () => {
    vi.stubEnv("MY_CLI_PATH", "/custom/bin/mycli")
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const result = resolveCliBinary({ bin: "mycli", envVar: "MY_CLI_PATH" })
    expect(result).toBe("/custom/bin/mycli")
  })

  it("ignores env var when empty string", () => {
    vi.stubEnv("MY_CLI_PATH", "")
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const result = resolveCliBinary({ bin: "nonexistent-cli-xyz", envVar: "MY_CLI_PATH" })
    expect(result).toBeUndefined()
  })

  it("does not consult envVar when envVar is undefined", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const result = resolveCliBinary({ bin: "nonexistent-cli-xyz" })
    expect(result).toBeUndefined()
  })
})

// ─── PATH scan ────────────────────────────────────────────────────────────────

describe("resolveCliBinary: PATH scan", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })

  it("finds binary in PATH dir (Unix-style, no extension)", () => {
    const fakeDir = "/fake/bin"
    const expectedPath = path.join(fakeDir, "codex")

    vi.stubEnv("PATH", fakeDir)
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    const result = resolveCliBinary({ bin: "codex" })
    expect(result).toBe(expectedPath)
  })

  it("finds binary in PATH dir with PATHEXT extension on Windows", () => {
    const fakeDir = "/fake/bin"
    const expectedPath = path.join(fakeDir, "codex.EXE")

    vi.stubEnv("PATH", fakeDir)
    vi.stubEnv("PATHEXT", ".EXE;.CMD;.BAT")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    const result = resolveCliBinary({ bin: "codex" })
    expect(result).toBe(expectedPath)
  })

  it("returns undefined when binary is not found in PATH", () => {
    vi.stubEnv("PATH", "/fake/bin")
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = resolveCliBinary({ bin: "nonexistent-cli-xyz" })
    expect(result).toBeUndefined()
  })

  it("handles PATH=empty gracefully (no crash)", () => {
    vi.stubEnv("PATH", "")
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockReturnValue(false)

    // Should not throw
    expect(() => resolveCliBinary({ bin: "codex" })).not.toThrow()
  })

  it("returns first hit in PATH (multiple dirs)", () => {
    const dir1 = "/first/bin"
    const dir2 = "/second/bin"
    const expectedPath = path.join(dir1, "codex")

    vi.stubEnv("PATH", [dir1, dir2].join(path.delimiter))
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    const result = resolveCliBinary({ bin: "codex" })
    expect(result).toBe(expectedPath)
  })
})

// ─── knownPaths ──────────────────────────────────────────────────────────────

describe("resolveCliBinary: knownPaths", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })

  it("finds binary in knownPaths directory when not in PATH", () => {
    const knownDir = "/known/location"
    const expectedPath = path.join(knownDir, "codex")

    vi.stubEnv("PATH", "/empty/bin")
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    const result = resolveCliBinary({ bin: "codex", knownPaths: [knownDir] })
    expect(result).toBe(expectedPath)
  })

  it("returns PATH hit before reaching knownPaths", () => {
    // When the binary is found in PATH, it must be returned — knownPaths not relevant.
    const pathDir = "/has/the/bin"
    const knownDir = "/known/location"
    const pathHit = path.join(pathDir, "codex")
    const knownHit = path.join(knownDir, "codex")

    vi.stubEnv("PATH", pathDir)
    vi.stubEnv("PATHEXT", "")
    // PATH dir has the binary; knownPaths dir also has it — must return PATH hit.
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
      return String(p) === pathHit || String(p) === knownHit
    })

    const result = resolveCliBinary({ bin: "codex", knownPaths: [knownDir] })
    // Should return the PATH hit, not the knownPaths hit (first-match wins = PATH first)
    expect(result).toBe(pathHit)
  })

  it("accepts a full path directly in knownPaths (not just dir)", () => {
    const fullPath = "/opt/codex/bin/codex"

    vi.stubEnv("PATH", "")
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === fullPath)

    const result = resolveCliBinary({ bin: "codex", knownPaths: [fullPath] })
    expect(result).toBe(fullPath)
  })
})

// ─── miss → undefined ─────────────────────────────────────────────────────────

describe("resolveCliBinary: miss returns undefined", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })

  it("returns undefined when nothing is found anywhere", () => {
    vi.stubEnv("PATH", "")
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = resolveCliBinary({ bin: "completely-nonexistent-cli" })
    expect(result).toBeUndefined()
  })
})
