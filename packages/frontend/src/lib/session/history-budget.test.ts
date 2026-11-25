import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const root = fileURLToPath(new URL("../../", import.meta.url))
const sessionDir = join(root, "lib/session")

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : []
  })
}

describe("history-budget (F2)", () => {
  it("production session code does not embed maxBytes numeric literals", () => {
    const hits: string[] = []
    for (const file of walk(sessionDir)) {
      const text = readFileSync(file, "utf8")
      if (/maxBytes\s*[:=]\s*\d/.test(text)) {
        hits.push(relative(root, file))
      }
    }
    expect(hits).toEqual([])
  })
})
