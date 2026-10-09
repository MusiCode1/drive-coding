/**
 * Integration: readEffectiveDeveloperInstructions against real codex (isolated CODEX_HOME).
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readEffectiveDeveloperInstructions } from "./codex-acp-startup.js"

const hasCodex = spawnSync("codex", ["--version"], { encoding: "utf8" }).status === 0

describe.skipIf(!hasCodex)("readEffectiveDeveloperInstructions (live codex)", () => {
  it("with project trust, effective instructions match project layer (measurement C)", async () => {
    const root = mkdtempSync(join(tmpdir(), "dc-codex-di-"))
    const home = join(root, "home")
    const proj = join(root, "proj")
    mkdirSync(home, { recursive: true })
    mkdirSync(join(proj, ".codex"), { recursive: true })
    writeFileSync(join(home, "config.toml"), 'developer_instructions = "SENT_USER"\n')
    writeFileSync(join(proj, ".codex", "config.toml"), 'developer_instructions = "SENT_PROJECT"\n')

    const prev = process.env.CODEX_HOME
    process.env.CODEX_HOME = home
    try {
      const value = await readEffectiveDeveloperInstructions({ cwd: proj })
      expect(value).toBe("SENT_PROJECT")
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = prev
    }
  })
})
