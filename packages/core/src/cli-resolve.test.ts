/**
 * cli-resolve.test.ts — TDD tests for resolveCliBinary.
 *
 * Tests: env-override, PATH-hit, PATHEXT on Windows, pm-global-bins, knownPaths, miss→undefined.
 *
 * ESM note: vi.spyOn on named exports from node:fs is not configurable in ESM.
 * We use vi.mock('node:fs') with a factory instead.
 */

import * as path from "node:path"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

// Mock node:fs before importing the module under test.
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}))

import * as fs from "node:fs"
// Import after mock is set up.
import { type BinaryCache, resolveCliBinary, resolveCliBinaryCached } from "./cli-resolve.js"

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

// ─── absolute/relative path in `bin` ──────────────────────────────────────────

describe("resolveCliBinary: absolute/relative path in bin", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })

  it("returns absolute path as-is when it exists", () => {
    const absPath = "/home/user/.local/bin/cline-acp-patched"
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === absPath)

    const result = resolveCliBinary({ bin: absPath })
    expect(result).toBe(absPath)
  })

  it("returns undefined when absolute path does not exist", () => {
    const absPath = "/home/user/.local/bin/nonexistent-cli"
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = resolveCliBinary({ bin: absPath })
    expect(result).toBeUndefined()
  })

  it("resolves ./relative path when it exists", () => {
    const relPath = "./bin/mycli"
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === relPath)

    const result = resolveCliBinary({ bin: relPath })
    expect(result).toBe(relPath)
  })

  it("regression: plain binary name still resolves via PATH scan", () => {
    const fakeDir = "/fake/bin"
    const expectedPath = path.join(fakeDir, "codex")

    vi.stubEnv("PATH", fakeDir)
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    const result = resolveCliBinary({ bin: "codex" })
    expect(result).toBe(expectedPath)
  })

  it("regression: envVar still takes precedence over absolute path in bin", () => {
    const absPath = "/home/user/.local/bin/cline-acp-patched"
    vi.stubEnv("MY_CLI_PATH", "/env/override/mycli")
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === absPath)

    const result = resolveCliBinary({ bin: absPath, envVar: "MY_CLI_PATH" })
    expect(result).toBe("/env/override/mycli")
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

// ─── fallbackBins + resolveCliBinaryCached (slice cli-bin-resolution-unify) ───

describe("resolveCliBinaryCached", () => {
  // המטמון בבעלות הקורא (AGENTS.md: אין state ב-core) — Map טרי לכל טסט,
  // ולכן אין יותר מה "לאפס" גלובלית.
  let cache: BinaryCache

  beforeEach(() => {
    cache = new Map()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })

  // #1 — fallbackBins ריק/חסר → זהה לחלוטין לקיים (regression)
  it("no fallbackBins → identical to resolveCliBinary (regression)", () => {
    const fakeDir = "/fake/bin"
    const expectedPath = path.join(fakeDir, "codex")
    vi.stubEnv("PATH", fakeDir)
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    expect(resolveCliBinaryCached({ bin: "codex" }, process.env, cache)).toBe(expectedPath)
  })

  // #2 — רק cursor-agent קיים + fallbackBins:["cursor-agent"] → נמצא (הבאג המקורי)
  it("finds fallback when only the alt name exists (original bug)", () => {
    const fakeDir = "/fake/bin"
    const fallbackPath = path.join(fakeDir, "cursor-agent")
    vi.stubEnv("PATH", fakeDir)
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === fallbackPath)

    const result = resolveCliBinaryCached({ bin: "agent", fallbackBins: ["cursor-agent"] }, process.env, cache)
    expect(result).toBe(fallbackPath)
  })

  // #3 — שניהם קיימים → מחזיר את bin הראשי, לא את החלופה
  it("returns the primary bin when both primary and fallback exist", () => {
    const fakeDir = "/fake/bin"
    const primaryPath = path.join(fakeDir, "agent")
    const fallbackPath = path.join(fakeDir, "cursor-agent")
    vi.stubEnv("PATH", fakeDir)
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === primaryPath || p === fallbackPath)

    const result = resolveCliBinaryCached({ bin: "agent", fallbackBins: ["cursor-agent"] }, process.env, cache)
    expect(result).toBe(primaryPath)
  })

  // #4 — bin בתיקייה מאוחרת ב-PATH, חלופה בתיקייה מוקדמת → הראשי מנצח (name-major)
  it("name-major: primary wins even when the fallback sits earlier in PATH", () => {
    const earlyDir = "/early/bin" // fallback only
    const laterDir = "/later/bin" // primary
    const fallbackPath = path.join(earlyDir, "cursor-agent")
    const primaryPath = path.join(laterDir, "agent")
    vi.stubEnv("PATH", [earlyDir, laterDir].join(path.delimiter))
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === fallbackPath || p === primaryPath)

    const result = resolveCliBinaryCached({ bin: "agent", fallbackBins: ["cursor-agent"] }, process.env, cache)
    expect(result).toBe(primaryPath)
  })

  // #5 — envVar מוגדר → גובר על שניהם, ולא נבדק שוב לכל fallback
  it("envVar wins over primary and fallback, checked once only", () => {
    vi.stubEnv("MY_CLI_PATH", "/env/override/agent")
    vi.stubEnv("PATH", "/fake/bin")
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = resolveCliBinaryCached({
      bin: "agent",
      envVar: "MY_CLI_PATH",
      fallbackBins: ["cursor-agent"],
    }, process.env, cache)
    expect(result).toBe("/env/override/agent")
  })

  // #6 — קריאה שנייה מחזירה אותו ערך בלי גישה נוספת ל-fs (חוץ מאימות ה-hit)
  it("second read returns the cached value with a single existsSync call (hit-verification only)", () => {
    const fakeDir = "/fake/bin"
    const expectedPath = path.join(fakeDir, "codex")
    vi.stubEnv("PATH", fakeDir)
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    expect(resolveCliBinaryCached({ bin: "codex" }, process.env, cache)).toBe(expectedPath)

    vi.mocked(fs.existsSync).mockClear()
    expect(resolveCliBinaryCached({ bin: "codex" }, process.env, cache)).toBe(expectedPath)
    expect(vi.mocked(fs.existsSync)).toHaveBeenCalledTimes(1)
  })

  // #7 — שלילי לא נשמר: קריאה 1 → לא נמצא; "יצירת" הקובץ (toggle ה-mock); קריאה 2 → נמצא
  it("negative result is never cached — toggling the mock to 'exists' is picked up on next read", () => {
    vi.stubEnv("PATH", "/fake/bin")
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(resolveCliBinaryCached({ bin: "codex" }, process.env, cache)).toBeUndefined()

    const expectedPath = path.join("/fake/bin", "codex")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)
    expect(resolveCliBinaryCached({ bin: "codex" }, process.env, cache)).toBe(expectedPath)
  })

  // #8 — אימות-על-hit: קריאה 1 → נמצא; "מחיקת" הקובץ (toggle ה-mock); קריאה 2 → undefined
  it("verifies existence on cache hit — toggling the mock to 'missing' invalidates the entry", () => {
    const fakeDir = "/fake/bin"
    const expectedPath = path.join(fakeDir, "codex")
    vi.stubEnv("PATH", fakeDir)
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    expect(resolveCliBinaryCached({ bin: "codex" }, process.env, cache)).toBe(expectedPath)

    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(resolveCliBinaryCached({ bin: "codex" }, process.env, cache)).toBeUndefined()
  })

  // #9 — ניקוי המטמון (בבעלות הקורא) → הקריאה הבאה פותרת מחדש
  it("clearing the caller-owned cache forces a full re-resolution on the next call", () => {
    // שני תיקיות PATH — הראשונה ריקה, השנייה עם ה-binary. כך הסריקה המלאה
    // (אחרי הניקוי) קוראת ל-existsSync לפחות פעמיים (miss dir1 + hit dir2),
    // בעוד ש-cache-hit תמיד קורא פעם אחת בלבד (טסט #6) — ההבדל ניתן להבחנה.
    const dir1 = "/fake/bin1"
    const dir2 = "/fake/bin2"
    const expectedPath = path.join(dir2, "codex")
    vi.stubEnv("PATH", [dir1, dir2].join(path.delimiter))
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    expect(resolveCliBinaryCached({ bin: "codex" }, process.env, cache)).toBe(expectedPath)

    cache.clear() // ← הבעלים מנקה. אין יותר invalidateBinaryCache()
    vi.mocked(fs.existsSync).mockClear()
    expect(resolveCliBinaryCached({ bin: "codex" }, process.env, cache)).toBe(expectedPath)
    // after clearing, this is a full re-scan — not a single hit-check call.
    expect(vi.mocked(fs.existsSync).mock.calls.length).toBeGreaterThan(1)
  })

  // #10 — מפתח: אותו bin עם PATH שונה → לא מחזיר את הערך המוטמן של השני
  it("cache key includes PATH — same bin resolves independently per PATH value", () => {
    const dirA = "/fake/a"
    const dirB = "/fake/b"
    const pathA = path.join(dirA, "codex")
    const pathB = path.join(dirB, "codex")

    vi.stubEnv("PATH", dirA)
    vi.stubEnv("PATHEXT", "")
    vi.mocked(fs.existsSync).mockImplementation((p) => p === pathA)
    expect(resolveCliBinaryCached({ bin: "codex" }, process.env, cache)).toBe(pathA)

    vi.stubEnv("PATH", dirB)
    vi.mocked(fs.existsSync).mockImplementation((p) => p === pathB)
    expect(resolveCliBinaryCached({ bin: "codex" }, process.env, cache)).toBe(pathB)
  })
})
