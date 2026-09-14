/**
 * paths.test.ts — TDD tests for getStateDir / ensureStateSubdir.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ensureStateSubdir, getStateDir } from "../src/paths.js"

describe("getStateDir", () => {
  it("returns os.homedir()/.config/drive-coding (boot-layer C5)", () => {
    expect(getStateDir()).toBe(path.join(os.homedir(), ".config", "drive-coding"))
  })
})

describe("ensureStateSubdir", () => {
  const created: string[] = []

  afterEach(() => {
    for (const p of created) {
      try {
        fs.rmSync(p, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    created.length = 0
  })

  it("creates subdir and returns correct path", () => {
    const name = `recordings-test-${Date.now()}`
    const result = ensureStateSubdir(name)
    created.push(result)
    expect(result).toBe(path.join(getStateDir(), name))
    expect(fs.existsSync(result)).toBe(true)
  })

  it("idempotent — double call does not throw", () => {
    const name = `cache-test-${Date.now()}`
    created.push(path.join(getStateDir(), name))
    expect(() => {
      ensureStateSubdir(name)
      ensureStateSubdir(name)
    }).not.toThrow()
  })

  it("supports multiple segments (nested subdir)", () => {
    const name = `cache-proxy-test-${Date.now()}`
    const result = ensureStateSubdir("cache", `${name}`)
    created.push(result)
    expect(result).toBe(path.join(getStateDir(), "cache", name))
    expect(fs.existsSync(result)).toBe(true)
  })
})
