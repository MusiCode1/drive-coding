/**
 * prefer-path-cli.test.ts — TDD tests for preferPathClaudeExecutable.
 *
 * Reuses the cli-resolve.test.ts mocking pattern: mock node:fs (existsSync only),
 * then per-test vi.stubEnv("PATH", ...) + vi.mocked(fs.existsSync).mockReturnValue(...)
 * to simulate presence/absence of `claude` on PATH. No temp-dir, no real files,
 * no exec-bit check (resolveCliBinary only checks existsSync).
 */

import * as fs from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"

// Mock node:fs before importing the module under test.
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}))

// Import after mock is set up.
import { preferPathClaudeExecutable } from "./prefer-path-cli.js"

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe("preferPathClaudeExecutable", () => {
  it("sets CLAUDE_CODE_EXECUTABLE from PATH when claude is found and env is unset", () => {
    vi.stubEnv("PATH", "/fake/bin")
    vi.mocked(fs.existsSync).mockReturnValue(true)

    const env: NodeJS.ProcessEnv = { PATH: "/fake/bin" }
    preferPathClaudeExecutable(env)

    expect(env.CLAUDE_CODE_EXECUTABLE).toBe("/fake/bin/claude")
  })

  it("respects an already-set CLAUDE_CODE_EXECUTABLE override (does not overwrite)", () => {
    vi.stubEnv("PATH", "/fake/bin")
    vi.mocked(fs.existsSync).mockReturnValue(true)

    const env: NodeJS.ProcessEnv = {
      PATH: "/fake/bin",
      CLAUDE_CODE_EXECUTABLE: "/custom/claude",
    }
    preferPathClaudeExecutable(env)

    expect(env.CLAUDE_CODE_EXECUTABLE).toBe("/custom/claude")
  })

  it("is a no-op (leaves undefined) when no claude is found anywhere", () => {
    vi.stubEnv("PATH", "/fake/bin")
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const env: NodeJS.ProcessEnv = { PATH: "/fake/bin" }
    preferPathClaudeExecutable(env)

    expect(env.CLAUDE_CODE_EXECUTABLE).toBeUndefined()
  })
})
