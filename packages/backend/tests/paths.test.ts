/**
 * paths.test.ts — בדיקות TDD ל-getStateDir / ensureStateSubdir.
 *
 * Covers:
 *  1. getStateDir() מחזיר <home>/.config/drive-coding — עם mock HOME (POSIX-style)
 *  2. getStateDir() מחזיר <home>/.config/drive-coding — עם mock USERPROFILE (Windows-style)
 *  3. ensureStateSubdir("recordings") יוצר את התיקייה ומחזיר את הנתיב
 *  4. ensureStateSubdir idempotent — קריאה כפולה לא זורקת
 *  5. ensureStateSubdir תומך במספר segments (nested subdir)
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock child_process כמו ב-http-options.test — http-options מפעיל execFileSync
const execFileSyncMock = vi.fn().mockReturnValue("")
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}))

// ייבוא סטטי — getHomeDir קורא process.env בזמן ריצה (לא ב-import), כך שstubEnv תקף
import { ensureStateSubdir, getStateDir } from "../src/paths.js"

describe("getStateDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("מחזיר <HOME>/.config/drive-coding כש-HOME מוגדר", () => {
    const fakeHome = path.join(os.tmpdir(), "fake-home-posix")
    vi.stubEnv("HOME", fakeHome)
    vi.stubEnv("USERPROFILE", "")
    expect(getStateDir()).toBe(path.join(fakeHome, ".config", "drive-coding"))
  })

  it("מחזיר <USERPROFILE>/.config/drive-coding כש-USERPROFILE מוגדר ו-HOME ריק", () => {
    const fakeHome = path.join(os.tmpdir(), "fake-home-win")
    vi.stubEnv("HOME", "")
    vi.stubEnv("USERPROFILE", fakeHome)
    expect(getStateDir()).toBe(path.join(fakeHome, ".config", "drive-coding"))
  })
})

describe("ensureStateSubdir", () => {
  let tmpBase: string

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "state-dir-test-"))
    vi.stubEnv("HOME", tmpBase)
    vi.stubEnv("USERPROFILE", "")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true })
    } catch {
      // התעלם
    }
  })

  it("יוצר תת-תיקייה ומחזיר נתיב נכון", () => {
    const result = ensureStateSubdir("recordings")
    const expected = path.join(tmpBase, ".config", "drive-coding", "recordings")
    expect(result).toBe(expected)
    expect(fs.existsSync(result)).toBe(true)
  })

  it("idempotent — קריאה כפולה לא זורקת", () => {
    expect(() => {
      ensureStateSubdir("cache")
      ensureStateSubdir("cache")
    }).not.toThrow()
  })

  it("תומך במספר segments (nested subdir)", () => {
    const result = ensureStateSubdir("cache", "proxy")
    const expected = path.join(tmpBase, ".config", "drive-coding", "cache", "proxy")
    expect(result).toBe(expected)
    expect(fs.existsSync(result)).toBe(true)
  })
})
