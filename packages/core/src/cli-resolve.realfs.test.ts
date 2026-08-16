/**
 * cli-resolve.realfs.test.ts — real filesystem test for resolveCliBinary.
 *
 * Isolated from cli-resolve.test.ts on purpose: that file `vi.mock("node:fs")`
 * at module level, so there is no way to exercise a real symlink there (no
 * realpath, no actual directory tree). This file makes NO fs mock — it creates
 * a real temp dir + a real symlink and asserts the resolver returns the link
 * path, not the realpath() target.
 *
 * §0 of the brief: cursor's installer points two names (`agent`, `cursor-agent`)
 * at a version-numbered target directory. Resolving through realpath() would
 * bake in a version path that breaks on the next upgrade — so resolveCliBinary
 * must return the symlink itself.
 *
 * mkdtempSync (not a fixed tmpdir path) — the root vitest run also picks up
 * packages/core/dist/*.test.js, so this exact test would otherwise run twice
 * in parallel and collide on the same directory.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { resolveCliBinary } from "./cli-resolve.js"

describe("resolveCliBinary: real fs — symlink is not resolved to its target", () => {
  it("returns the symlink path, not the realpath() target", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-resolve-realfs-"))
    try {
      // שם ייחודי (לא "cursor-agent") — §0 מתעד ש-~/.local/bin/cursor-agent אמיתי
      // קיים על מכונת-הפיתוח; שם אמיתי היה מתנגש עם pm-global-bins ומאבד את
      // הנקודה של הטסט (בדיקת knownPaths, לא PATH האמיתי).
      const binName = "cli-resolve-realfs-fixture"
      const targetDir = path.join(tmpDir, "versions", "1.2.3")
      fs.mkdirSync(targetDir, { recursive: true })
      const targetPath = path.join(targetDir, binName)
      fs.writeFileSync(targetPath, "#!/bin/sh\n")
      fs.chmodSync(targetPath, 0o755)

      const linkPath = path.join(tmpDir, binName)
      fs.symlinkSync(targetPath, linkPath)

      const result = resolveCliBinary({ bin: binName, knownPaths: [tmpDir] }, { PATH: "" })

      expect(result).toBe(linkPath)
      expect(result).not.toBe(fs.realpathSync(linkPath))
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
