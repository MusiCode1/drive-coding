/**
 * cli-availability.test.ts — TDD tests for detectAvailableClis.
 *
 * Tests: PATH-hit → source "path", miss → "not-found", override precedence
 * (overrideKinds skips envVar), envVar-hit still reports "path" (not a
 * dedicated "env" source — matches §4 API skeleton), default specs=CLI_SPECS.
 *
 * ESM note: vi.mock('node:fs') factory, same pattern as cli-resolve.test.ts
 * (co-located, PATH mocked via fake env objects passed explicitly).
 */

import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}))

import * as fs from "node:fs"
import { detectAvailableClis } from "./cli-availability.js"
import type { CliKind, CliSpec } from "./schemas/agent.js"

afterEach(() => {
  vi.clearAllMocks()
  vi.mocked(fs.existsSync).mockReturnValue(false)
})

const specs = {
  opencode: { bin: "opencode", args: ["acp"], supportsModelFlag: false, envVar: "OPENCODE_BIN" },
  claude: { bin: "claude-cli", args: [], supportsModelFlag: true },
} as unknown as Record<CliKind, CliSpec>

describe("detectAvailableClis: PATH scan", () => {
  it("reports found + source path when binary is on PATH", () => {
    const env = { PATH: "/fake/bin", PATHEXT: "" }
    vi.mocked(fs.existsSync).mockImplementation((p) => p === "/fake/bin/claude-cli")

    const result = detectAvailableClis(specs, env)

    expect(result.available).toContain("claude")
    expect(result.details.claude).toEqual({
      found: true,
      path: "/fake/bin/claude-cli",
      source: "path",
    })
  })

  it("reports not-found + excludes from available when binary is missing", () => {
    const env = { PATH: "/fake/bin", PATHEXT: "" }
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = detectAvailableClis(specs, env)

    expect(result.available).not.toContain("claude")
    expect(result.details.claude).toEqual({ found: false, source: "not-found" })
  })
})

describe("detectAvailableClis: envVar", () => {
  it("resolves via spec.envVar when set — source is still 'path' (no dedicated env source)", () => {
    const env = { PATH: "", PATHEXT: "", OPENCODE_BIN: "/custom/opencode" }
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = detectAvailableClis(specs, env)

    expect(result.available).toContain("opencode")
    expect(result.details.opencode).toEqual({
      found: true,
      path: "/custom/opencode",
      source: "path",
    })
  })
})

describe("detectAvailableClis: overrideKinds", () => {
  it("ignores envVar and reports source 'override' when kind is in overrideKinds and bin is found", () => {
    // override.bin replaces spec.bin — simulate by giving specs an already-merged bin,
    // but envVar must be ignored: PATH has the override bin, envVar points elsewhere unfound.
    const env = { PATH: "/fake/bin", PATHEXT: "", OPENCODE_BIN: "" }
    vi.mocked(fs.existsSync).mockImplementation((p) => p === "/fake/bin/opencode")

    const result = detectAvailableClis(specs, env, ["opencode"])

    expect(result.available).toContain("opencode")
    expect(result.details.opencode).toEqual({
      found: true,
      path: "/fake/bin/opencode",
      source: "override",
    })
  })

  it("reports not-found + source 'not-found' when overrideKind bin is missing", () => {
    const env = { PATH: "/fake/bin", PATHEXT: "" }
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = detectAvailableClis(specs, env, ["opencode"])

    expect(result.available).not.toContain("opencode")
    expect(result.details.opencode).toEqual({ found: false, source: "not-found" })
  })
})

describe("detectAvailableClis: detectBin", () => {
  const detectBinSpecs = {
    claude: { bin: "npx", args: [], supportsModelFlag: true, detectBin: "claude" },
  } as unknown as Record<CliKind, CliSpec>

  it("resolves via detectBin (not bin) when detectBin is set — regular branch", () => {
    const env = { PATH: "/fake/bin", PATHEXT: "" }
    vi.mocked(fs.existsSync).mockImplementation((p) => p === "/fake/bin/claude")

    const result = detectAvailableClis(detectBinSpecs, env)

    expect(result.available).toContain("claude")
    expect(result.details.claude).toEqual({
      found: true,
      path: "/fake/bin/claude",
      source: "path",
    })
  })

  it("does not find via bin (npx) when only detectBin's binary is missing", () => {
    const env = { PATH: "/fake/bin", PATHEXT: "" }
    // only npx exists on PATH, not claude — detectBin must still be checked, not bin.
    vi.mocked(fs.existsSync).mockImplementation((p) => p === "/fake/bin/npx")

    const result = detectAvailableClis(detectBinSpecs, env)

    expect(result.available).not.toContain("claude")
    expect(result.details.claude).toEqual({ found: false, source: "not-found" })
  })

  it("override branch ignores detectBin and uses spec.bin (override precedence)", () => {
    const overrideSpecs = {
      claude: {
        bin: "claude-override",
        args: [],
        supportsModelFlag: true,
        detectBin: "claude",
      },
    } as unknown as Record<CliKind, CliSpec>
    const env = { PATH: "/fake/bin", PATHEXT: "" }
    // only the override bin name exists on PATH — "claude" (detectBin) does not.
    vi.mocked(fs.existsSync).mockImplementation((p) => p === "/fake/bin/claude-override")

    const result = detectAvailableClis(overrideSpecs, env, ["claude"])

    expect(result.available).toContain("claude")
    expect(result.details.claude).toEqual({
      found: true,
      path: "/fake/bin/claude-override",
      source: "override",
    })
  })
})

describe("detectAvailableClis: defaults", () => {
  it("defaults specs param to CLI_SPECS when not passed", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = detectAvailableClis()

    // CLI_SPECS has 7 kinds today; all not-found under a clean mocked fs.
    expect(Object.keys(result.details).length).toBeGreaterThan(0)
    expect(result.available).toEqual([])
  })
})
