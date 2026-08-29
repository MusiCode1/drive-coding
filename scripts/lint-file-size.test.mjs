// @ts-check
//
// Regression tests for the size+impurity ratchet. Each case builds a lab
// tree under os.tmpdir() and runs the CLI — a mock would not catch a
// ratchet that never fails.

import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const SCRIPT = path.resolve(import.meta.dirname, "lint-file-size.mjs")
const REPO = path.resolve(import.meta.dirname, "..")
const BUDGETS_SRC = path.join(REPO, "size-budgets.json")
const FAT = "packages/lab/src/util/fat.ts"
/** util mixed budget = 150. 200 lines of mixed code is over budget → baseline. */
const OVER = 200
const OVER_GROWN = 220
const OVER_SHRUNK = 180

let lab

/** Mixed (clock impurity) file with exactly `n` newline characters. */
function mixedFile(n) {
  const lines = ["export const t = Date.now()"]
  while (lines.length < n) lines.push(`const n${lines.length} = ${lines.length}`)
  return `${lines.join("\n")}\n`
}

function writeFat(n) {
  writeFileSync(path.join(lab, FAT), mixedFile(n))
}

function readBaseline() {
  return JSON.parse(readFileSync(path.join(lab, "size-baseline.json"), "utf8"))
}

function run(args = []) {
  try {
    const output = execFileSync("node", [SCRIPT, "--root", lab, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    })
    return { output, exitCode: 0 }
  } catch (e) {
    return {
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
      exitCode: e.status ?? 1,
    }
  }
}

beforeEach(() => {
  lab = mkdtempSync(path.join(os.tmpdir(), "lint-size-"))
  mkdirSync(path.dirname(path.join(lab, FAT)), { recursive: true })
  cpSync(BUDGETS_SRC, path.join(lab, "size-budgets.json"))
  writeFat(OVER)
  const init = run(["--init-baseline"])
  expect(init.exitCode, init.output).toBe(0)
})

afterEach(() => {
  rmSync(lab, { recursive: true, force: true })
})

describe("lint-file-size on the repo", () => {
  it("is green and does not flag core/session/reduce.ts", () => {
    try {
      const output = execFileSync("node", [SCRIPT], {
        cwd: REPO,
        encoding: "utf8",
        stdio: "pipe",
      })
      expect(output).toMatch(/no growth/)
      expect(output).not.toMatch(/reduce\.ts/)
    } catch (e) {
      const output = `${e.stdout ?? ""}${e.stderr ?? ""}`
      expect(output).not.toMatch(/reduce\.ts/)
      throw new Error(output)
    }
  })
})

describe("lint-file-size ratchet", () => {
  it("a baseline file that grew is red", () => {
    const before = readBaseline().files[FAT].metric
    writeFat(OVER_GROWN)
    const r = run()
    expect(r.exitCode).toBe(1)
    expect(r.output).toMatch(/metric grew/)
    expect(r.output).toContain(`${before} → ${OVER_GROWN}`)
    expect(readBaseline().files[FAT].metric).toBe(before)
  })

  it("a baseline file that shrank is green and --update-baseline lowers the recorded metric", () => {
    const before = readBaseline().files[FAT].metric
    writeFat(OVER_SHRUNK)
    const stale = run()
    expect(stale.exitCode).toBe(1)
    expect(stale.output).toMatch(/stale baseline/)
    expect(readBaseline().files[FAT].metric).toBe(before)

    const down = run(["--update-baseline"])
    expect(down.exitCode, down.output).toBe(0)
    expect(down.output).toMatch(/wrote-down/)
    expect(readBaseline().files[FAT].metric).toBe(OVER_SHRUNK)
    expect(readBaseline().files[FAT].metric).toBeLessThan(before)
  })

  it("refuses to raise a baseline entry via --update-baseline", () => {
    const before = readBaseline().files[FAT].metric
    writeFat(OVER_GROWN)
    const r = run(["--update-baseline"])
    expect(r.exitCode).toBe(1)
    expect(r.output).toMatch(/metric grew/)
    expect(readBaseline().files[FAT].metric).toBe(before)
    expect(readBaseline().files[FAT].metric).toBeLessThan(OVER_GROWN)
  })

  it("impurity growth on a baseline file is red even when lines stay put", () => {
    const before = readBaseline().files[FAT]
    writeFileSync(
      path.join(lab, FAT),
      mixedFile(OVER).replace("Date.now()", "Date.now() + Date.now()"),
    )
    const r = run()
    expect(r.exitCode).toBe(1)
    expect(r.output).toMatch(/impurity grew/)
    expect(readBaseline().files[FAT].impurity).toBe(before.impurity)
  })
})
