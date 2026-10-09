import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { runBootLegacyImport } from "./history-import.js"

describe("runBootLegacyImport", () => {
  let home: string
  let prevHome: string | undefined

  afterEach(() => {
    if (prevHome !== undefined) process.env.HOME = prevHome
    else delete process.env.HOME
    delete process.env.HISTORY_DB_FILE
    if (home) rmSync(home, { recursive: true, force: true })
  })

  it("HISTORY_DB_FILE override skips automatic import from home tree", async () => {
    home = mkdtempSync(join(tmpdir(), "dc-import-home-"))
    prevHome = process.env.HOME
    process.env.HOME = home
    const dbFile = join(home, "override.sqlite")
    process.env.HISTORY_DB_FILE = dbFile
    mkdirSync(join(home, ".config", "drive-coding", "token-usage"), { recursive: true })
    writeFileSync(join(home, ".config", "drive-coding", "token-usage", "sessions.json"), "{}")
    await runBootLegacyImport({}, process.env)
    expect(existsSync(dbFile)).toBe(false)
  })

  it("explicit legacySources imports even with override", async () => {
    home = mkdtempSync(join(tmpdir(), "dc-import-fix-"))
    prevHome = process.env.HOME
    process.env.HOME = home
    const dbFile = join(home, "override.sqlite")
    process.env.HISTORY_DB_FILE = dbFile
    const usagePath = join(home, "usage.json")
    writeFileSync(
      usagePath,
      JSON.stringify({
        s1: {
          acpSessionId: "s1",
          agentId: "a1",
          cliKind: "claude",
          cwd: "/p",
          firstSeenAt: 1,
          lastSeenAt: 2,
          turns: 0,
          lastUsed: 1,
          size: 1,
          cycles: [{ startedAt: 1, peakUsed: 1, closedAt: null }],
          cyclesTruncated: false,
        },
      }),
    )
    await runBootLegacyImport({}, process.env, {
      legacySources: { usageJsonPath: usagePath },
      deadlineAt: Date.now() + 3000,
    })
    expect(existsSync(dbFile)).toBe(true)
  })
})
