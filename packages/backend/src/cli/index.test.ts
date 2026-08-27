/**
 * C1: subcommand flags must not hit server parseArgs.
 * Spawns the real bin — if the peek is missing, stderr contains Unexpected argument.
 */

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const bin = fileURLToPath(new URL("../bin/drive-coding.ts", import.meta.url))

function run(args: string[]): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env }
    delete env.PORT
    const child = spawn("bun", [bin, ...args], { env })
    let stderr = ""
    let stdout = ""
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString()
    })
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString()
    })
    child.on("close", (code) => resolve({ code, stderr, stdout }))
  })
}

describe("CLI branch before parseArgs", () => {
  it("agent list --json is not rejected as an unknown option or positional", async () => {
    const r = await run(["agent", "list", "--json"])
    expect(r.stderr).not.toMatch(/Unexpected argument/)
    expect(r.stderr).not.toMatch(/Unknown option/)
    expect(r.stdout).not.toMatch(/single-command server/)
  })

  it("instances is not rejected as an unexpected positional", async () => {
    const r = await run(["instances"])
    expect(r.stderr).not.toMatch(/Unexpected argument/)
    expect(r.stdout).not.toMatch(/single-command server/)
  })
})
